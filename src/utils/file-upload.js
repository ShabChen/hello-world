// 修改ajax函数,添加上传进度监听
function ajax(options = {}) {
    const defaultOptions = {
        method: 'GET',
        url: '',
        data: null,
        headers: {},
        async: true,
        onProgress: null
    }
    options = { ...defaultOptions, ...options }

    // 创建AbortController实例用于取消请求
    const controller = new AbortController()

    const promise = new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open(options.method, options.url, options.async)

        Object.keys(options.headers).forEach(key => {
            xhr.setRequestHeader(key, options.headers[key])
        })

        // 添加上传进度监听
        if (options.onProgress) {
            xhr.upload.onprogress = options.onProgress
        }

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response)
                } else {
                    reject(new Error(xhr.statusText))
                }
            }
        }

        xhr.onerror = function () {
            reject(new Error('Network Error'))
        }

        // 监听abort事件
        xhr.onabort = function () {
            reject(new Error('Request aborted'))
        }

        // 监听controller的abort信号
        controller.signal.addEventListener('abort', () => {
            xhr.abort()
        })

        xhr.send(options.data)
    })

    // 返回promise和取消方法
    return {
        promise,
        abort: () => controller.abort()
    }
}

// 大文件分片上传函数
function uploadChunks(file, chunkSize = 2 * 1024 * 1024) {
    // 参数校验
    if (!file || !(file instanceof File)) {
        throw new Error('请传入有效的文件对象')
    }

    // 文件分片,使用Blob.slice优化性能
    const chunks = []
    let start = 0
    while (start < file.size) {
        chunks.push(file.slice(start, start + chunkSize))
        start += chunkSize
    }

    // 上传进度,使用WeakMap避免内存泄漏
    const progressMap = new WeakMap()
    let uploadedSize = 0
    const totalSize = file.size

    // 优化1: 添加暂停/恢复/取消功能
    let isPaused = false
    let isCanceled = false
    const pendingChunks = [...Array(chunks.length).keys()]
    const uploadingChunks = new Set()

    // 优化2: 动态调整并发数
    let concurrentLimit = 3
    const maxConcurrent = 5
    const minConcurrent = 2

    // 优化3: 添加重试次数限制
    const maxRetries = 3
    const retryDelays = [1000, 2000, 3000] // 递增重试延迟

    // 上传单个分片的函数
    const uploadChunk = async (index, retryCount = 0) => {
        if (isPaused || isCanceled) return

        uploadingChunks.add(index)
        const chunk = chunks[index]
        const formData = new FormData()
        formData.append('chunk', chunk)
        formData.append('index', index)
        formData.append('filename', file.name)
        formData.append('totalChunks', chunks.length)
        formData.append('chunkHash', await calculateHash(chunk))

        try {
            const result = await ajax({
                url: '/upload',
                method: 'POST',
                data: formData,
                headers: {
                    'X-Upload-Id': file.name + '-' + Date.now() // 添加上传ID用于断点续传
                },
                onProgress: event => {
                    if (event.lengthComputable) {
                        progressMap.set(chunk, event.loaded)
                        uploadedSize = Array.from(progressMap.values()).reduce(
                            (a, b) => a + b,
                            0
                        )
                        const progress = (
                            (uploadedSize / totalSize) *
                            100
                        ).toFixed(2)
                        console.log(`上传进度: ${progress}%`)
                    }
                }
            }).promise

            uploadingChunks.delete(index)
            // 动态调整并发数
            if (retryCount === 0) {
                concurrentLimit = Math.min(maxConcurrent, concurrentLimit + 1)
            }
            return result
        } catch (error) {
            uploadingChunks.delete(index)

            if (!isPaused && !isCanceled && retryCount < maxRetries) {
                console.log(`分片${index}上传失败,第${retryCount + 1}次重试`)
                // 使用递增延迟重试
                await new Promise(resolve =>
                    setTimeout(resolve, retryDelays[retryCount])
                )
                return uploadChunk(index, retryCount + 1)
            }

            // 连续失败时减少并发数
            concurrentLimit = Math.max(minConcurrent, concurrentLimit - 1)
            throw error
        }
    }

    // 处理上传队列
    const processQueue = async () => {
        if (isPaused || isCanceled) return

        while (
            pendingChunks.length > 0 &&
            uploadingChunks.size < concurrentLimit
        ) {
            const index = pendingChunks.shift()
            uploadChunk(index).catch(error => {
                if (!isPaused && !isCanceled) {
                    console.error(`分片${index}上传失败:`, error)
                    pendingChunks.push(index)
                    processQueue()
                }
            })
        }
    }

    // 优化哈希计算
    const calculateHash = (() => {
        const hashCache = new WeakMap()

        return blob => {
            if (hashCache.has(blob)) {
                return Promise.resolve(hashCache.get(blob))
            }

            return new Promise(resolve => {
                const reader = new FileReader()
                reader.onload = e => {
                    const result = e.target.result
                    let hash = 0
                    for (let i = 0; i < result.length; i++) {
                        hash = (hash << 5) - hash + result.charCodeAt(i)
                        hash |= 0
                    }
                    const hashStr = hash.toString(16)
                    hashCache.set(blob, hashStr)
                    resolve(hashStr)
                }
                reader.readAsArrayBuffer(blob)
            })
        }
    })()

    // 返回控制对象
    const controller = {
        start: () => {
            isPaused = false
            isCanceled = false
            processQueue()
            return controller.promise
        },
        pause: () => {
            isPaused = true
        },
        resume: () => {
            isPaused = false
            processQueue()
        },
        cancel: () => {
            isCanceled = true
            isPaused = true
            uploadingChunks.clear()
            pendingChunks.length = 0
        },
        promise: new Promise((resolve, reject) => {
            let checkTimer = null

            const checkComplete = () => {
                if (isCanceled) {
                    clearTimeout(checkTimer)
                    reject(new Error('Upload canceled'))
                    return
                }

                if (
                    pendingChunks.length === 0 &&
                    uploadingChunks.size === 0 &&
                    !isPaused
                ) {
                    // 所有分片上传完成后,通知服务器合并文件
                    ajax({
                        url: '/merge',
                        method: 'POST',
                        data: JSON.stringify({
                            filename: file.name,
                            size: chunks.length,
                            totalSize: file.size
                        }),
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    })
                        .promise.then(resolve)
                        .catch(reject)
                        .finally(() => clearTimeout(checkTimer))
                } else {
                    checkTimer = setTimeout(checkComplete, 500)
                }
            }

            checkComplete()
        })
    }

    return controller
}

// 使用示例:
const fileInput = document.querySelector('input[type="file"]')
fileInput.onchange = e => {
    const file = e.target.files[0]
    const uploader = uploadChunks(file)

    // 开始上传
    uploader
        .start()
        .then(() => {
            console.log('上传完成')
        })
        .catch(err => {
            console.error('上传失败:', err)
        })

    // 暂停按钮点击事件
    pauseBtn.onclick = () => uploader.pause()

    // 恢复按钮点击事件
    resumeBtn.onclick = () => uploader.resume()
}

// ... existing code ...

// 大文件分片上传函数 - 使用 Worker 和 IndexedDB 优化
function uploadChunks(file, chunkSize = 2 * 1024 * 1024) {
    // 参数校验
    if (!file || !(file instanceof File)) {
        throw new Error('请传入有效的文件对象')
    }

    // 创建唯一上传ID
    const uploadId = `${file.name}-${file.size}-${Date.now()}`

    // 状态管理
    let isPaused = false
    let isCanceled = false
    const uploadingChunks = new Set()

    // 配置参数
    const concurrentLimit = 3
    const maxRetries = 3
    const retryDelays = [1000, 2000, 3000]

    // 创建和启动 Worker
    const hashWorker = createHashWorker()

    // 进度回调函数
    let progressCallback = () => {}

    // 返回的控制对象
    const controller = {
        start: () => {
            isPaused = false
            isCanceled = false

            // 初始化数据库
            return initIndexedDB()
                .then(() => prepareChunks())
                .then(() => startUpload())
                .then(() => controller.promise)
        },
        pause: () => {
            isPaused = true
        },
        resume: () => {
            isPaused = false
            continueUpload()
        },
        cancel: () => {
            isCanceled = true
            isPaused = true
            uploadingChunks.clear()

            // 清理资源
            hashWorker.terminate()

            // 可选: 清理数据库中的缓存
            clearUploadCache(uploadId)
        },
        onProgress: callback => {
            if (typeof callback === 'function') {
                progressCallback = callback
            }
            return controller
        },
        promise: new Promise((resolve, reject) => {
            controller._resolve = resolve
            controller._reject = reject
        })
    }

    // 创建用于计算哈希的 Web Worker
    function createHashWorker() {
        const workerCode = `
          self.onmessage = function(e) {
              const { chunk, index } = e.data;
              
              // 计算哈希
              crypto.subtle.digest('SHA-256', chunk)
                  .then(hashBuffer => {
                      const hashArray = Array.from(new Uint8Array(hashBuffer));
                      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                      self.postMessage({ index, hash: hashHex });
                  })
                  .catch(err => {
                      self.postMessage({ index, error: err.message });
                  });
          }
      `

        const blob = new Blob([workerCode], { type: 'application/javascript' })
        const worker = new Worker(URL.createObjectURL(blob))

        return worker
    }

    // 索引数据库初始化
    function initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('FileUploadDB', 1)

            request.onerror = () => reject(new Error('无法打开上传缓存数据库'))

            request.onupgradeneeded = event => {
                const db = event.target.result

                // 创建存储分片信息的存储空间
                if (!db.objectStoreNames.contains('chunks')) {
                    const store = db.createObjectStore('chunks', {
                        keyPath: 'id'
                    })
                    store.createIndex('uploadId', 'uploadId', { unique: false })
                }

                // 创建存储分片上传状态的存储空间
                if (!db.objectStoreNames.contains('uploadStatus')) {
                    const store = db.createObjectStore('uploadStatus', {
                        keyPath: 'id'
                    })
                    store.createIndex('uploadId', 'uploadId', { unique: false })
                }
            }

            request.onsuccess = event => {
                const db = event.target.result
                controller.db = db
                resolve()
            }
        })
    }

    // 准备文件分片并存储在 IndexedDB 中
    function prepareChunks() {
        return new Promise((resolve, reject) => {
            // 检查是否已存在上传记录
            getUploadStatus(uploadId)
                .then(status => {
                    // 如果存在记录并且分片信息完整，直接使用
                    if (
                        status &&
                        status.totalChunks > 0 &&
                        status.preparedChunks === status.totalChunks
                    ) {
                        return resolve()
                    }

                    // 不存在或不完整，重新准备分片
                    const totalChunks = Math.ceil(file.size / chunkSize)
                    const chunksToProcess = []

                    // 创建上传状态记录
                    saveUploadStatus({
                        id: uploadId,
                        uploadId: uploadId,
                        fileName: file.name,
                        fileSize: file.size,
                        totalChunks: totalChunks,
                        uploadedChunks: 0,
                        preparedChunks: 0,
                        status: 'preparing'
                    })
                        .then(() => {
                            // 处理每个分片
                            for (let i = 0; i < totalChunks; i++) {
                                const start = i * chunkSize
                                const end = Math.min(
                                    start + chunkSize,
                                    file.size
                                )
                                const chunk = file.slice(start, end)

                                chunksToProcess.push(processChunk(i, chunk))
                            }

                            return Promise.all(chunksToProcess)
                        })
                        .then(() => {
                            // 更新状态，标记为已准备完成
                            return updateUploadStatus(uploadId, {
                                preparedChunks: totalChunks,
                                status: 'prepared'
                            })
                        })
                        .then(resolve)
                        .catch(reject)
                })
                .catch(reject)
        })
    }

    // 处理单个分片：计算哈希并保存到 IndexedDB
    function processChunk(index, chunk) {
        return new Promise((resolve, reject) => {
            // 使用 Worker 计算哈希
            hashWorker.postMessage({ chunk, index })

            const hashHandler = e => {
                const { index: responseIndex, hash, error } = e.data

                if (responseIndex !== index) return // 不是当前分片的响应

                hashWorker.removeEventListener('message', hashHandler)

                if (error) {
                    reject(new Error(`计算分片 ${index} 哈希失败: ${error}`))
                    return
                }

                // 保存分片信息到 IndexedDB
                saveChunkInfo({
                    id: `${uploadId}-${index}`,
                    uploadId: uploadId,
                    index: index,
                    hash: hash,
                    size: chunk.size,
                    status: 'pending',
                    retries: 0
                })
                    .then(() => {
                        // 保存分片数据
                        return saveChunkData(`${uploadId}-${index}`, chunk)
                    })
                    .then(resolve)
                    .catch(reject)
            }

            hashWorker.addEventListener('message', hashHandler)
        })
    }

    // 开始上传
    function startUpload() {
        return getUploadStatus(uploadId).then(status => {
            if (status.status === 'completed') {
                return controller._resolve('文件已上传完成')
            }

            // 更新状态为上传中
            return updateUploadStatus(uploadId, { status: 'uploading' })
                .then(() => queryPendingChunks(uploadId))
                .then(pendingChunks => {
                    // 没有待上传的分片，直接完成
                    if (pendingChunks.length === 0) {
                        return mergeChunks()
                    }

                    // 按并发数开始上传
                    for (
                        let i = 0;
                        i < Math.min(concurrentLimit, pendingChunks.length);
                        i++
                    ) {
                        uploadChunk(pendingChunks[i].index)
                    }
                })
        })
    }

    // 继续上传（用于恢复）
    function continueUpload() {
        if (isPaused || isCanceled) return

        queryPendingChunks(uploadId).then(pendingChunks => {
            const availableSlots = concurrentLimit - uploadingChunks.size

            if (availableSlots <= 0 || pendingChunks.length === 0) return

            // 填充可用的上传槽
            for (
                let i = 0;
                i < Math.min(availableSlots, pendingChunks.length);
                i++
            ) {
                if (!uploadingChunks.has(pendingChunks[i].index)) {
                    uploadChunk(pendingChunks[i].index)
                }
            }
        })
    }

    // 上传单个分片
    function uploadChunk(index, retryCount = 0) {
        if (isPaused || isCanceled) return

        uploadingChunks.add(index)

        // 从 IndexedDB 获取分片信息和数据
        Promise.all([
            getChunkInfo(`${uploadId}-${index}`),
            getChunkData(`${uploadId}-${index}`)
        ])
            .then(([chunkInfo, chunkData]) => {
                // 更新分片状态为上传中
                return updateChunkInfo(`${uploadId}-${index}`, {
                    status: 'uploading'
                }).then(() => {
                    const formData = new FormData()
                    formData.append('chunk', chunkData)
                    formData.append('index', index)
                    formData.append('filename', file.name)
                    formData.append('uploadId', uploadId)
                    formData.append('totalChunks', chunkInfo.totalChunks)
                    formData.append('chunkHash', chunkInfo.hash)

                    return ajax({
                        url: '/upload',
                        method: 'POST',
                        data: formData,
                        headers: {
                            'X-Upload-Id': uploadId
                        },
                        onProgress: event => {
                            if (event.lengthComputable) {
                                updateChunkProgress(
                                    index,
                                    event.loaded / event.total
                                )
                            }
                        }
                    }).promise
                })
            })
            .then(() => {
                uploadingChunks.delete(index)

                // 更新分片状态为已完成
                return updateChunkInfo(`${uploadId}-${index}`, {
                    status: 'completed',
                    completedAt: new Date().toISOString()
                })
            })
            .then(() => {
                // 更新上传状态
                return incrementUploadedChunks(uploadId)
            })
            .then(status => {
                // 检查是否所有分片都已上传完成
                if (status.uploadedChunks === status.totalChunks) {
                    mergeChunks()
                } else {
                    continueUpload() // 继续上传下一个分片
                }
            })
            .catch(error => {
                uploadingChunks.delete(index)

                if (isPaused || isCanceled) return

                // 重试逻辑
                if (retryCount < maxRetries) {
                    console.log(
                        `分片${index}上传失败,第${retryCount + 1}次重试`
                    )

                    // 更新重试次数
                    updateChunkInfo(`${uploadId}-${index}`, {
                        status: 'failed',
                        retries: retryCount + 1,
                        lastError: error.message
                    }).then(() => {
                        // 使用递增延迟重试
                        setTimeout(() => {
                            uploadChunk(index, retryCount + 1)
                        }, retryDelays[retryCount])
                    })
                } else {
                    // 超过重试次数，标记为失败
                    updateChunkInfo(`${uploadId}-${index}`, {
                        status: 'failed',
                        retries: retryCount + 1,
                        lastError: error.message
                    }).then(() => {
                        console.error(
                            `分片${index}上传失败,已达到最大重试次数:`,
                            error
                        )
                        controller._reject(
                            new Error(`上传失败: ${error.message}`)
                        )
                    })
                }
            })
    }

    // 合并分片
    function mergeChunks() {
        return updateUploadStatus(uploadId, { status: 'merging' })
            .then(() => {
                return ajax({
                    url: '/merge',
                    method: 'POST',
                    data: JSON.stringify({
                        filename: file.name,
                        uploadId: uploadId,
                        totalChunks: Math.ceil(file.size / chunkSize),
                        totalSize: file.size
                    }),
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }).promise
            })
            .then(result => {
                return updateUploadStatus(uploadId, {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    serverResponse: JSON.stringify(result)
                })
            })
            .then(() => {
                controller._resolve(result)
                return result
            })
            .catch(error => {
                updateUploadStatus(uploadId, {
                    status: 'failed',
                    lastError: error.message
                })
                controller._reject(error)
                throw error
            })
    }

    // 更新上传进度
    function updateChunkProgress(index, progress) {
        getUploadStatus(uploadId).then(status => {
            // 计算总体进度
            let totalProgress = 0
            let completedChunks = status.uploadedChunks
            let inProgressChunk = index
            let inProgressValue = progress

            totalProgress =
                (completedChunks + inProgressValue) / status.totalChunks

            // 调用进度回调
            progressCallback({
                totalProgress,
                completedChunks,
                totalChunks: status.totalChunks,
                uploadedBytes:
                    completedChunks * chunkSize + inProgressValue * chunkSize,
                totalBytes: file.size
            })
        })
    }

    // 数据库操作函数
    function saveChunkInfo(chunkInfo) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['chunks'],
                'readwrite'
            )
            const store = transaction.objectStore('chunks')
            const request = store.put(chunkInfo)

            request.onsuccess = () => resolve()
            request.onerror = () => reject(new Error('保存分片信息失败'))
        })
    }

    function updateChunkInfo(id, updates) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['chunks'],
                'readwrite'
            )
            const store = transaction.objectStore('chunks')
            const request = store.get(id)

            request.onsuccess = () => {
                const data = request.result
                if (!data) {
                    return reject(new Error(`分片信息不存在: ${id}`))
                }

                Object.assign(data, updates)
                const updateRequest = store.put(data)

                updateRequest.onsuccess = () => resolve(data)
                updateRequest.onerror = () =>
                    reject(new Error('更新分片信息失败'))
            }

            request.onerror = () => reject(new Error('获取分片信息失败'))
        })
    }

    function getChunkInfo(id) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['chunks'],
                'readonly'
            )
            const store = transaction.objectStore('chunks')
            const request = store.get(id)

            request.onsuccess = () => {
                if (!request.result) {
                    return reject(new Error(`分片信息不存在: ${id}`))
                }
                resolve(request.result)
            }

            request.onerror = () => reject(new Error('获取分片信息失败'))
        })
    }

    function saveChunkData(id, data) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['chunks'],
                'readwrite'
            )
            const store = transaction.objectStore('chunks')
            const request = store.get(id)

            request.onsuccess = () => {
                if (!request.result) {
                    return reject(new Error(`分片信息不存在: ${id}`))
                }

                const chunkInfo = request.result
                chunkInfo.data = data

                const updateRequest = store.put(chunkInfo)
                updateRequest.onsuccess = () => resolve()
                updateRequest.onerror = () =>
                    reject(new Error('保存分片数据失败'))
            }

            request.onerror = () => reject(new Error('获取分片信息失败'))
        })
    }

    function getChunkData(id) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['chunks'],
                'readonly'
            )
            const store = transaction.objectStore('chunks')
            const request = store.get(id)

            request.onsuccess = () => {
                if (!request.result || !request.result.data) {
                    return reject(new Error(`分片数据不存在: ${id}`))
                }
                resolve(request.result.data)
            }

            request.onerror = () => reject(new Error('获取分片数据失败'))
        })
    }

    function saveUploadStatus(status) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['uploadStatus'],
                'readwrite'
            )
            const store = transaction.objectStore('uploadStatus')
            const request = store.put(status)

            request.onsuccess = () => resolve(status)
            request.onerror = () => reject(new Error('保存上传状态失败'))
        })
    }

    function updateUploadStatus(id, updates) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['uploadStatus'],
                'readwrite'
            )
            const store = transaction.objectStore('uploadStatus')
            const request = store.get(id)

            request.onsuccess = () => {
                const data = request.result
                if (!data) {
                    return reject(new Error(`上传状态不存在: ${id}`))
                }

                Object.assign(data, updates)
                const updateRequest = store.put(data)

                updateRequest.onsuccess = () => resolve(data)
                updateRequest.onerror = () =>
                    reject(new Error('更新上传状态失败'))
            }

            request.onerror = () => reject(new Error('获取上传状态失败'))
        })
    }

    function getUploadStatus(id) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['uploadStatus'],
                'readonly'
            )
            const store = transaction.objectStore('uploadStatus')
            const request = store.get(id)

            request.onsuccess = () => {
                resolve(request.result || null)
            }

            request.onerror = () => reject(new Error('获取上传状态失败'))
        })
    }

    function incrementUploadedChunks(id) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['uploadStatus'],
                'readwrite'
            )
            const store = transaction.objectStore('uploadStatus')
            const request = store.get(id)

            request.onsuccess = () => {
                const data = request.result
                if (!data) {
                    return reject(new Error(`上传状态不存在: ${id}`))
                }

                data.uploadedChunks += 1
                const updateRequest = store.put(data)

                updateRequest.onsuccess = () => resolve(data)
                updateRequest.onerror = () =>
                    reject(new Error('更新上传状态失败'))
            }

            request.onerror = () => reject(new Error('获取上传状态失败'))
        })
    }

    function queryPendingChunks(uploadId) {
        return new Promise((resolve, reject) => {
            const transaction = controller.db.transaction(
                ['chunks'],
                'readonly'
            )
            const store = transaction.objectStore('chunks')
            const index = store.index('uploadId')
            const request = index.openCursor(IDBKeyRange.only(uploadId))

            const pendingChunks = []

            request.onsuccess = event => {
                const cursor = event.target.result
                if (cursor) {
                    const chunk = cursor.value
                    if (
                        chunk.status === 'pending' ||
                        chunk.status === 'failed'
                    ) {
                        pendingChunks.push(chunk)
                    }
                    cursor.continue()
                } else {
                    // 按索引排序
                    pendingChunks.sort((a, b) => a.index - b.index)
                    resolve(pendingChunks)
                }
            }

            request.onerror = () => reject(new Error('查询待上传分片失败'))
        })
    }

    function clearUploadCache(uploadId) {
        return new Promise((resolve, reject) => {
            // 删除分片数据
            const chunksTransaction = controller.db.transaction(
                ['chunks'],
                'readwrite'
            )
            const chunksStore = chunksTransaction.objectStore('chunks')
            const chunksIndex = chunksStore.index('uploadId')
            const chunksRequest = chunksIndex.openCursor(
                IDBKeyRange.only(uploadId)
            )

            chunksRequest.onsuccess = event => {
                const cursor = event.target.result
                if (cursor) {
                    chunksStore.delete(cursor.value.id)
                    cursor.continue()
                }
            }

            chunksTransaction.oncomplete = () => {
                // 删除上传状态
                const statusTransaction = controller.db.transaction(
                    ['uploadStatus'],
                    'readwrite'
                )
                const statusStore =
                    statusTransaction.objectStore('uploadStatus')
                statusStore.delete(uploadId)

                statusTransaction.oncomplete = () => resolve()
                statusTransaction.onerror = () =>
                    reject(new Error('清理上传状态失败'))
            }

            chunksTransaction.onerror = () =>
                reject(new Error('清理分片数据失败'))
        })
    }

    return controller
}

// 使用示例:
const fileInput = document.querySelector('input[type="file"]')
fileInput.onchange = e => {
    const file = e.target.files[0]
    const uploader = uploadChunks(file)

    // 监听上传进度
    uploader.onProgress(progress => {
        console.log(`上传进度: ${(progress.totalProgress * 100).toFixed(2)}%`)
        progressBar.style.width = `${progress.totalProgress * 100}%`
    })

    // 开始上传
    uploader
        .start()
        .then(() => {
            console.log('上传完成')
        })
        .catch(err => {
            console.error('上传失败:', err)
        })

    // 暂停按钮点击事件
    pauseBtn.onclick = () => uploader.pause()

    // 恢复按钮点击事件
    resumeBtn.onclick = () => uploader.resume()

    // 取消按钮点击事件
    cancelBtn.onclick = () => uploader.cancel()
}
