
const arr = []

/**
 * 前序遍历
 * @param {*} node 
 * @returns 
 */
function preOrderTraverse(node) {
    if (node == null) return

    arr.push(node.value)

    preOrderTraverse(node.left)
    preOrderTraverse(node.right)
}

/**
 * 中序遍历
 * @param {*} node 
 * @returns 
 */
function inOrderTraverse(node) {
    if (node == null) return

    inOrderTraverse(node.left)
    arr.push(node.value)
    inOrderTraverse(node.right)
}

/**
 * 后序遍历
 * @param {*} node 
 * @returns 
 */
function postOrderTraverse(node) {
    if (node == null) return

    postOrderTraverse(node.left)
    postOrderTraverse(node.right)
    arr.push(node.value)
}

/**
 * BST: 第k小值
 * @param {*} node 
 * @param {*} k 
 * @returns 
 */
function getKthMin(node, k) {
    inOrderTraverse(node)
    return arr[k-1]
}

function getKthMax(node, k) {
    inOrderTraverse(node)
    return arr[arr.length - k]
}
