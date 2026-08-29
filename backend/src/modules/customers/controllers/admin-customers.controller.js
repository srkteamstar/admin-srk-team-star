/*
 * modules/customers/controllers/admin-customers.controller.js
 * ============================================================================
 *
 * A CRM view over user_profiles, plus exactly two writes.
 *
 * BLOCKING EXISTS BECAUSE THE STOREFRONT DOOR TAKES NO SECRET. An account is
 * reachable by anyone who knows the identifier on it, and before this the only
 * answer to one being abused was deletion - which destroys the order history
 * with it. A block closes four doors (login, requireCustomer, /api/auth/me and
 * checkout's guest adoption); closing fewer would be worth nothing.
 *
 * DELETE REFUSES THE COMMON CASE, on purpose. orders.user_id is NOT NULL, so
 * removing a profile that has ever ordered would leave an invoice with nobody
 * attached. The route counts orders first and answers 409 with the count and a
 * sentence saying to block instead.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { requireAdmin, roleNameById } = require('../../../core/security/guards');
const { customerWriteRefusal } = require('../services/customer-write-refusal.service');
const { paginationFor, setPaginationHeaders } = require('../../../core/http/pagination');

/** @returns {import('express').Router} */
function adminCustomersController() {
    const router = express.Router();

    router.get('/api/customers', requireAdmin, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        try {
            const pagination = paginationFor(req, res);
            if (!pagination) return;
            const { data: customers, count, error: customersError } = await supabase
                .from('user_profiles')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(pagination.from, pagination.to);

            if (customersError) throw customersError;

            if (!customers || customers.length === 0) {
                setPaginationHeaders(res, pagination, count);
                return res.status(200).json([]);
            }

            const customerIds = customers.map(c => c.id);
            const roleIds = [...new Set(customers.map(c => c.role_id).filter(id => id !== null && id !== undefined))];

            const [rolesRes, ordersRes, addressesRes] = await Promise.all([
                roleIds.length
                    ? supabase.from('roles').select('id, role_name').in('id', roleIds)
                    : Promise.resolve({ data: [] }),
                supabase.from('orders').select('id, user_id, order_number, amount, shipping_amount, tax_amount, net_amount, status, tracking, created_at').in('user_id', customerIds),
                supabase.from('shipping_addresses').select('*').in('user_id', customerIds)
            ]);

            if (rolesRes.error) throw rolesRes.error;
            if (ordersRes.error) throw ordersRes.error;
            if (addressesRes.error) throw addressesRes.error;

            // The line items behind those orders, in one further round trip
            // keyed by the order ids just fetched — the same shape
            // fetchOrderRows() uses above. Without them the customer drawer can
            // say a customer spent 39,825 and not what on, which is the first
            // question anyone opening that drawer has.
            const orderIds = (ordersRes.data || []).map(o => o.id);
            const itemsByOrder = new Map();

            if (orderIds.length) {
                const { data: items, error: itemsError } = await supabase
                    .from('order_items')
                    .select('*')
                    .in('order_id', orderIds);

                if (itemsError) throw itemsError;

                (items || []).forEach(item => {
                    const key = String(item.order_id);
                    const list = itemsByOrder.get(key) || [];
                    list.push(item);
                    itemsByOrder.set(key, list);
                });
            }

            const roleNameById = new Map((rolesRes.data || []).map(r => [String(r.id), r.role_name]));

            const ordersByCustomer = new Map();
            (ordersRes.data || []).forEach(order => {
                const key = String(order.user_id);
                const list = ordersByCustomer.get(key) || [];
                list.push(order);
                ordersByCustomer.set(key, list);
            });

            const addressesByCustomer = new Map();
            (addressesRes.data || []).forEach(address => {
                const key = String(address.user_id);
                const list = addressesByCustomer.get(key) || [];
                list.push(address);
                addressesByCustomer.set(key, list);
            });

            const rows = customers.map(customer => {
                const orders = (ordersByCustomer.get(String(customer.id)) || [])
                    .slice()
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                const totalSpent = orders.reduce((sum, o) => sum + (Number(o.net_amount) || 0), 0);

                return {
                    id: customer.id,
                    full_name: customer.full_name,
                    email: customer.email,
                    phone_number: customer.phone_number,
                    company: customer.company || null,
                    created_at: customer.created_at,
                    updated_at: customer.updated_at || null,
                    role: customer.role_id !== null && customer.role_id !== undefined
                        ? roleNameById.get(String(customer.role_id)) || null
                        : null,
                    // Every field here is named rather than spread, and that
                    // stays that way now the credential columns are gone: this
                    // route selects '*', so a projection is the only thing
                    // stopping a column added later from being published by
                    // default.
                    is_blocked: customer.is_blocked === true,
                    blocked_at: customer.blocked_at || null,
                    orders: orders.map(o => ({
                        id: o.id,
                        order_number: o.order_number,
                        amount: o.amount,
                        shipping_amount: o.shipping_amount,
                        tax_amount: o.tax_amount,
                        net_amount: o.net_amount,
                        status: o.status || 'Processing',
                        tracking: o.tracking || null,
                        created_at: o.created_at,
                        items: (itemsByOrder.get(String(o.id)) || []).map(item => ({
                            id: item.id,
                            product_id: item.product_id,
                            product_name: item.product_name,
                            price: item.price,
                            quantity: item.quantity,
                            total_amount: item.total_amount
                        }))
                    })),
                    order_count: orders.length,
                    total_spent: totalSpent,
                    last_purchase_at: orders.length ? orders[0].created_at : null,
                    addresses: (addressesByCustomer.get(String(customer.id)) || []).map(a => ({
                        id: a.id,
                        full_address: a.full_address,
                        city: a.city,
                        state: a.state,
                        country: a.country,
                        zip_code: a.zip_code
                    }))
                };
            });

            setPaginationHeaders(res, pagination, count);
            res.status(200).json(rows);
        } catch (error) {
            console.error("Fetch Customers Error:", error);
            res.status(500).json({ error: "Failed to fetch customers." });
        }
    });

    // The one gate both admin writes below pass through, so the two refusals
    // cannot drift apart or be remembered in one route and forgotten in the
    // other. Returns null when the target is fair game, or the { status, error }
    // to answer with when it is not.
    //
    // It re-reads the target from the database rather than trusting anything the
    // dashboard sent about it — the role in particular, which is the whole point

    // ---- Block / unblock -------------------------------------------------------
    // Reversible, which is the whole reason it exists beside a delete that mostly
    // is not available. What "blocked" costs the customer is enforced in four
    // places (login, requireCustomer, /api/auth/me, checkout) rather than by
    // hiding anything — see migration 016.
    router.patch('/api/customers/:id/status', requireAdmin, async (req, res) => {
        if (typeof req.body.blocked !== 'boolean') {
            return res.status(400).json({ error: "Send { blocked: true } or { blocked: false }." });
        }

        const blocked = req.body.blocked;

        try {
            const refusal = await customerWriteRefusal(req, req.params.id);
            if (refusal.error) return res.status(refusal.status).json({ error: refusal.error });

            const { data, error } = await supabase
                .from('user_profiles')
                .update({
                    is_blocked: blocked,
                    // Cleared on unblock, so the column never reads as "blocked
                    // on 3 March" for an account that is currently fine.
                    blocked_at: blocked ? new Date().toISOString() : null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', req.params.id)
                .select('id, is_blocked, blocked_at')
                .single();

            if (error) throw error;

            res.status(200).json({
                success: true,
                id: data.id,
                is_blocked: data.is_blocked === true,
                blocked_at: data.blocked_at || null
            });
        } catch (error) {
            console.error("Block Customer Error:", error);
            res.status(500).json({ error: "Could not change that account's status." });
        }
    });

    // ---- Delete ----------------------------------------------------------------
    // Deliberately refuses the common case. See the block comment above this
    // route group for why an order is a wall rather than something to cascade
    // through.
    router.delete('/api/customers/:id', requireAdmin, async (req, res) => {
        try {
            const refusal = await customerWriteRefusal(req, req.params.id);
            if (refusal.error) return res.status(refusal.status).json({ error: refusal.error });

            // The database function re-checks role/self/order conditions while
            // holding the target row lock, then deletes the address and profile
            // in one transaction. A storefront order cannot slip between a
            // count and the delete, and a failed profile delete cannot strand
            // the customer without their saved address.
            const { data: result, error: deleteError } = await supabase.rpc('delete_admin_customer', {
                p_actor_id: req.profile.id,
                p_target_id: req.params.id
            });
            if (deleteError) throw deleteError;

            if (result && result.result === 'has_orders') {
                const count = Number(result.order_count) || 0;
                return res.status(409).json({
                    error: `This customer has ${count} order${count === 1 ? '' : 's'} against their name. Deleting the profile would leave ${count === 1 ? 'that order' : 'those orders'} without one. Block the account instead — it stops them signing in and can be undone.`,
                    order_count: count
                });
            }

            if (!result || result.result === 'not_found') {
                return res.status(404).json({ error: "That customer no longer exists." });
            }
            if (result.result === 'self') {
                return res.status(400).json({ error: "You cannot delete the account you are signed in with." });
            }
            if (result.result === 'administrator') {
                return res.status(403).json({ error: "Administrator accounts cannot be deleted from here." });
            }
            if (result.result !== 'deleted') throw new Error('Unexpected customer deletion result.');

            res.status(200).json({ success: true, id: req.params.id });
        } catch (error) {
            console.error("Delete Customer Error:", error);

            // 23503 is a foreign key violation: some table this route does not
            // know about still points at the row. Say that rather than "failed",
            // because the fix is to look at that table, not to press again.
            if (error && error.code === '23503') {
                return res.status(409).json({
                    error: "Something else in the database still refers to this customer, so the profile cannot be removed. Block the account instead."
                });
            }

            res.status(500).json({ error: "Could not delete that customer." });
        }
    });

    return router;
}

module.exports = { adminCustomersController };
