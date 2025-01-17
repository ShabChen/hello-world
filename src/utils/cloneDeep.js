function cloneDeep(obj, map = new WeakMap()) {
    if (obj == null || typeof obj !== 'object') {
        return obj
    }

    const objFromMap = map.get(obj)
    if(objFromMap) {
        return objFromMap
    }

    let target = {}
    map.set(obj, target)

    if (obj instanceof Map) {
        target = new Map()
        obj.forEach((v, k) => {
            target.set(cloneDeep(k, map), cloneDeep(v, map))
        })
        return target
    }

    if (obj instanceof Set) {
        target = new Set()
        obj.forEach(v => {
            target.add(cloneDeep(v, map))
        })
        return target
    }

    if (obj instanceof Array) {
        target = obj.map(item => cloneDeep(item, map))
        return target
    }

    for (const key in obj) {
        target[key] = cloneDeep(obj[key], map)
    }
    return target
}