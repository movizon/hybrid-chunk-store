/*
 * @since 2022/03/14
 * @author Richard T <richard@movizon.org>
 * @description main module
 * Copyright (c) 2022 Movizon Platform
 */

/* eslint-env browser */
import FSAccessChunkStore from '@movizon/fsa-chunk-store'
import IDBChunkStore from 'idb-chunk-store'
import MemoryChunkStore from 'memory-chunk-store'
import CacheChunkStore from 'cache-chunk-store'

const isChrome = !!window.chrome

export default class HybridChunkStore {
  constructor(chunkLength, opts = {}) {
    this.chunkLength = Number(chunkLength)
    if (!this.chunkLength) throw new Error('First argument must be a chunk length')

    this.length = Number(opts.length) || Infinity

    this.fallbackStore = null
    this.chunkCount = null
    this.stores = []
    this.chunks = []

    // this is kinda stupid, first it makes the fallback store, then the main store
    // creates a store limited by targetLength, then uses memory as fallback/overflow
    // if targetlength is falsy then it will assume infinite storage
    const _mapStore = (TargetStore, targetLength) => {
      const newOpts = opts
      if (targetLength && targetLength < this.length) {
        this.chunkCount = Math.floor(targetLength / this.chunkLength)
        const newLength = this.chunkCount * this.chunkLength
        newOpts.length = this.length - newLength
        // ideally this should be blob store, some1 make one pls
        this.fallbackStore = new MemoryChunkStore(this.chunkLength, newOpts)
        this.stores.push(this.fallbackStore)
        newOpts.length = newLength
      }
      const store = new CacheChunkStore(new TargetStore(this.chunkLength, newOpts), {
        max: opts.max || 20,
      })
      this.stores.push(store)
      if (this.chunkCount) {
        this.chunks[this.chunkCount - 1] = store
        this.chunks.fill(store)
      } else {
        this.fallbackStore = store
      }
    }
    this.registration = navigator.storage.estimate().then((estimate) => {
      // use less than available
      const remaining =
        estimate.quota - estimate.usage - Math.max(Number(opts.reserved) || 0, 16777216)
      // if user only wants to use memory, or there is no space, force memory only
      if (opts.onlyMem === true || remaining <= 0) {
        this.fallbackStore = new MemoryChunkStore(this.chunkLength, opts)
        this.stores.push(this.fallbackStore)
        this.chunkCount = 0
      } else {
        if ('getDirectory' in navigator.storage) {
          // lets hope the user isn't stupid enough to specify a directory with barely any storage, forgive me tech support people
          // can't detect avaliable quota in custom folders
          _mapStore(FSAccessChunkStore, !opts.rootDir && remaining)
        } else {
          // WAH. https://i.kym-cdn.com/entries/icons/original/000/027/528/519.png
          // some OS versions and some chromium browsers report quota as 2^31 when it has more than that available
          // this means we can't estimate how much space they have... oh well
          _mapStore(IDBChunkStore, !(isChrome && estimate.quota === 2147483648) && remaining)
        }
      }
    })
  }

  get(index, opts, cb) {
    this.registration.then(() => {
      if (!this.chunks[index]) {
        this.fallbackStore.get(index - this.chunkCount, opts, cb)
      } else {
        this.chunks[index].get(index, opts, cb)
      }
    })
  }

  put(index, buf, cb) {
    this.registration.then(() => {
      if (!this.chunks[index]) {
        this.fallbackStore.put(index - this.chunkCount, buf, cb)
      } else {
        this.chunks[index].put(index, buf, cb)
      }
    })
  }

  close(cb = () => {}) {
    const promises = []
    for (const store of this.stores) {
      promises.push(new Promise((resolve) => store.close(resolve)))
    }
    Promise.all(promises).then((values) => {
      values = values.filter((value) => value)
      cb(values.length > 1 ? values : values[0])
    })
  }

  destroy(cb = () => {}) {
    const promises = []
    for (const store of this.stores) {
      promises.push(new Promise((resolve) => store.destroy(resolve)))
    }
    Promise.all(promises).then((values) => {
      values = values.filter((value) => value)
      cb(values.length > 1 ? values : values[0])
    })
  }
}
