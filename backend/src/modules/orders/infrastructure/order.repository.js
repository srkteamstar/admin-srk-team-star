/*
 * modules/orders/infrastructure/order.repository.js
 * ============================================================================
 *
 * fetchOrderRows() - every order, with its customer, items, frozen shipping
 * address and most recent payment, in a FIXED NUMBER OF QUERIES regardless of
 * how many orders there are. Five round trips and four Maps, never one query
 * per order.
 *
 * An order can carry more than one payment row (a retry after a failure), so
 * the most recent by created_at is the one that describes its current state.
 * modules/payments' gatewayPaymentRow() applies the identical rule, which is
 * why the dashboard and the gateway never disagree about which payment an
 * order means.
 */
const { supabase } = require('../../../core/database/supabase');

// Fixed number of queries regardless of how many orders there are, then
// grouped in JS — same shape as fetchProductRows()'s imagesByProduct Map.
async function fetchOrderRows(pagination) {
    let orderQuery = supabase
        .from('orders')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });
    if (pagination) orderQuery = orderQuery.range(pagination.from, pagination.to);
    const { data: orders, count, error: ordersError } = await orderQuery;

    if (ordersError) throw ordersError;
    if (!orders || orders.length === 0) return { rows: [], total: count || 0 };

    const orderIds = orders.map(o => o.id);
    const userIds = [...new Set(orders.map(o => o.user_id).filter(id => id !== null && id !== undefined))];

    const [customersRes, itemsRes, shippingRes, paymentsRes] = await Promise.all([
        userIds.length
            ? supabase.from('user_profiles').select('id, full_name, email, phone_number').in('id', userIds)
            : Promise.resolve({ data: [] }),
        supabase.from('order_items').select('*').in('order_id', orderIds),
        supabase.from('order_shipping_address').select('*').in('order_id', orderIds),
        supabase.from('payments').select('*').in('order_id', orderIds)
    ]);

    if (customersRes.error) throw customersRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (shippingRes.error) throw shippingRes.error;
    if (paymentsRes.error) throw paymentsRes.error;

    const customerById = new Map((customersRes.data || []).map(c => [String(c.id), c]));

    const itemsByOrder = new Map();
    (itemsRes.data || []).forEach(item => {
        const key = String(item.order_id);
        const list = itemsByOrder.get(key) || [];
        list.push(item);
        itemsByOrder.set(key, list);
    });

    const shippingByOrder = new Map((shippingRes.data || []).map(s => [String(s.order_id), s]));

    // An order can carry more than one payment row (a retry after a failure),
    // so the most recent by created_at is the one that actually describes
    // the order's current payment state.
    const paymentByOrder = new Map();
    (paymentsRes.data || []).forEach(payment => {
        const key = String(payment.order_id);
        const existing = paymentByOrder.get(key);
        if (!existing || new Date(payment.created_at) > new Date(existing.created_at)) {
            paymentByOrder.set(key, payment);
        }
    });

    const rows = orders.map(order => {
        const customer = order.user_id !== null && order.user_id !== undefined
            ? customerById.get(String(order.user_id)) || null
            : null;
        const shipping = shippingByOrder.get(String(order.id)) || null;
        const payment = paymentByOrder.get(String(order.id)) || null;

        // The storefront retains a terminal failed-payment row for gateway
        // reconciliation, because a late capture must still have somewhere to
        // land. It is a checkout attempt, not an order for fulfilment, and is
        // therefore deliberately absent from the console. A late capture
        // changes it to Payment Review/Paid and makes it visible again.
        if (order.status === 'Cancelled' && payment && payment.status === 'Failed') {
            return null;
        }

        return {
            id: order.id,
            order_number: order.order_number,
            status: order.status || 'Processing',
            tracking: order.tracking || null,
            confirmed_at: order.confirmed_at || null,
            cancellation_reason: order.cancellation_reason || null,
            refund_completed_at: order.refund_completed_at || null,
            amount: order.amount,
            tax_amount: order.tax_amount,
            net_amount: order.net_amount,
            created_at: order.created_at,
            customer: customer ? {
                id: customer.id,
                full_name: customer.full_name,
                email: customer.email,
                phone_number: customer.phone_number
            } : null,
            // Contact details belong to the order record, not only to an
            // account. Guest checkout deliberately has no user_profiles row,
            // but migration 030 freezes the buyer fields on `orders` for this
            // exact reason. Prefer that immutable snapshot for every order and
            // fall back to the profile only for historical pre-snapshot rows.
            contact: {
                full_name: order.buyer_name || (customer && customer.full_name) || null,
                company: order.buyer_company || null,
                email: order.buyer_email || (customer && customer.email) || null,
                phone_number: order.buyer_phone || (customer && customer.phone_number) || null,
                is_guest: !customer
            },
            items: (itemsByOrder.get(String(order.id)) || []).map(item => ({
                id: item.id,
                product_id: item.product_id,
                product_name: item.product_name,
                price: item.price,
                quantity: item.quantity,
                total_amount: item.total_amount
            })),
            shipping: shipping ? {
                full_address: shipping.full_address,
                city: shipping.city,
                state: shipping.state,
                country: shipping.country,
                zip_code: shipping.zip_code
            } : null,
            payment: payment ? {
                transaction_id: payment.transaction_id,
                payment_method: payment.payment_method,
                amount: payment.amount,
                status: payment.status,
                created_at: payment.created_at
            } : null
        };
    }).filter(Boolean);
    const hiddenOnPage = orders.length - rows.length;
    return {
        rows,
        total: count === null || count === undefined ? rows.length : Math.max(0, count - hiddenOnPage)
    };
}

module.exports = { fetchOrderRows };
