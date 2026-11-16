function redisCommand(client, method, ...args) {
    const target =
        typeof client.withCommandOptions === "function"
            ? client.withCommandOptions({ abortSignal: AbortSignal.timeout(5000) })
            : client
    return target[method](...args)
}
module.exports = { redisCommand }
