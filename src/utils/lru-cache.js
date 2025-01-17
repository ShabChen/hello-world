class LRUCache {
    constructor(maxLength) {
        this.maxLength = maxLength < 1 ? 1 : maxLength
        this.cache = new Map()
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key)
        }
        this.cache.set(key, value)
        if (this.cache.size > this.maxLength) {
            const delKey = this.cache.keys().next().value
            this.cache.delete(delKey)
        }
    }

    get(key) {
        if (!this.cache.has(key)) return null

        const value = this.cache.get(key)

        this.cache.delete(key)
        this.cache.set(key, value)
        return value
    }
}


class LRUCache2 {
    constructor (maxLength) {
        this.maxLength = maxLength < 1 ? 1 : maxLength
        this.nodeList = {}
        this.listHead = null
        this.listTail = null
        this.nodeListLength = 0
    }

    get(key) {
        const curNode = this.nodeList[key]

        if (!curNode) return null

        if (this.listTail === curNode) {
            return curNode.value
        }

        this.moveToTail(curNode)

        return curNode.value
    }

    moveToTail(curNode) {
        const tail = this.listTail
        if (tail === curNode) return

        const preNode = curNode.prev
        const nextNode = curNode.next

        if (preNode) {
            if (nextNode) {
                preNode.next = nextNode
            } else {
                delete preNode.next
            }
        }
        if (nextNode) {
            if (preNode) {
                nextNode.prev = preNode
            } else {
                delete nextNode.prev
                if (this.listHead === curNode) {
                    this.listHead = nextNode
                }
            }
        }

        delete curNode.prev
        delete curNode.next

        if (tail) {
            tail.next = curNode
            curNode.prev = tail
        }
        this.listTail = curNode
    }

    set(key, value) {
        const curNode = this.nodeList[key]

        if (!curNode) {
            const newNode = { key, value }
            this.moveToTail(newNode)

            this.nodeList[key] = newNode
            this.nodeListLength++

            if (this.nodeListLength === 1) {
                this.listHead = newNode
            }
        }
        else {
            curNode.value = value
            this.moveToTail(curNode)
        }

        this.clean()
    }

    clean() {
        while (this.nodeListLength > this.maxLength) {
            const head = this.listHead
            if (!head) throw new Error('head is null')
            const headNext = head.next
            if (!headNext) throw new Error('headNext is null')
            
            delete headNext.pre
            delete head.next
            delete this.nodeList[head.key]
            this.nodeListLength = this.nodeListLength - 1
            this.listHead = headNext
        }
    }
}