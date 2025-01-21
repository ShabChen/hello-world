function fabonacci(n) {
    if (n < 0) return new Error('n < 0')
    if (n === 0 || n === 1) return n

    // fn = fn-1 + fn-2
    let i = 2
    let f1 = 0
    let f2 = 1
    let tmp = 0
    while (i <= n) {
        tmp = f2
        f2 = f1 + f2
        f1 = tmp
        i++
    }
    return f2
}