function isMatch(left, right) {
    return ['{}', '[]', '{}'].includes(left + right)
}

function matchBracket(str) {
    const length = str.length
    if (length === 0) return true

    const stack = []
    const leftSymbol = '{[('
    const rightSymbol = ')]}'

    for (let i = 0; i < length; i++) {
        const s = str[i]

        if (leftSymbol.includes(s)) {
            stack.push(s)
        } else if (rightSymbol.includes(s)) {
            const top = stack[stack.length - 1]
            if (isMatch(top, s)) {
                stack.pop()
            }
            else {
                return false
            }
        }
    }
}