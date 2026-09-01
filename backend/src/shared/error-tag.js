function errorTag(error) {
    return (error && (error.code || error.name)) || 'unknown_error';
}

module.exports = { errorTag };
