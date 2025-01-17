class MyQueue {
    constructor () {
        this.stack1 = []
        this.stack2 = []
    }

    add(v) {
        if (this.stack2.length > 0) {
            while (this.stack2.length > 0) {
                this.stack1.push(this.stack2.pop())
            }
        }
        this.stack1.push(v)
    }

    pop() {
        if (this.stack2.length === 0) {
            while (this.stack1.length > 0) {
                this.stack2.push(this.stack1.pop())
            }
        }
        return this.stack2.pop()
    }

    get length() {
        return this.stack1.length || this.stack2.length
    }
}