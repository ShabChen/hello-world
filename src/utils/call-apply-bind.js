Function.prototype.myCall = function (context, ...args) {
    if (context == null) {
        context = globalThis
    }

    if (typeof context !== 'object') {
        context = new Object(context)
    }

    const fnKey = Symbol()
    context[fnKey] = this

    const result = context[fnKey](...args)

    delete context[fnKey]

    return result
}


Function.prototype.myApply = function (context, args) {
    if (context == null) {
        context = globalThis
    }

    if (typeof context !== 'object') {
        context = new Object(context)
    }

    const fnKey = Symbol()
    context[fnKey] = this

    const result = context[fnKey](...args)

    delete context[fnKey]

    return result
}


Function.prototype.myBind = function(context, ...bindArgs) {
    const fn = this
    return function (...args) {
        return fn.myApply(context, bindArgs.concat(args))
    }
}