function findNums(arr, n) {
    let left = 0
    let right = arr.length - 1

    while(left < right) {
        const sum = arr[left] + arr[right]
        if (sum === n) {
            return [arr[left], arr[right]]
        }

        if (sum > n) {
            right--
        } else {
            left++
        }
    }
    if (left === right) {
        throw new Error('not find')
    }
}