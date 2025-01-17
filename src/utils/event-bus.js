class EventBus {
    constructor () {
        this.events = {}
    }

    on (event, fn, isOnce) {
        if (!event) return
        if (!this.events[event]) {
            this.events[event] = []
        }
        this.events[event].push({ fn, isOnce})
    }

    once (event, fn) {
        this.on(event, fn, true)
    }

    off (event, fn) {
        if (!event || !this.events[event]) return 

        if (!fn) {
            this.events[event] = []
            return
        }

        // const fnList = this.events[event]
        this.events[event] = this.events[event].filter(item => item.fn !== fn)
    }

    emit (event, ...args) {
        if (!event) return
        const fnList = this.events[event]
        if (!fnList) return
        this.events[event] = fnList.filter(item => {
            const { fn, isOnce } = item
            fn(...args)
            return !isOnce
        })
    }
}