import { Watchable } from '../deps/ecs.js';
import { diff, merge, WeakCache } from '../deps/utils.js';


/**
 * Check that this works tomorrow
 * @import { Asset as AssetClass } from './asset.d.ts';
 */

/**
 * @typedef {{ refs: number, abortCtl?: AbortController, pending?: Promise<unknown>, data?: unknown }} AssetRef
 */

/** @type {WeakCache<{ assets: Map<string, AssetRef> }>} */
const _cache = new WeakCache();

/**
 * @extends {Watchable<{ 'data:load': any, 'instance:create': { instance: any, previous: any }, error: string, unload: void }>}
 * @implements {AssetClass<any>}
 */
export class Asset extends Watchable {
    #entity;

    /** @type {{ path: string | URL }} */
    #value;

    /** @type {string} */
    #path;

    /** @type {Asset[]|undefined} */
    #referer;

    /** @type {string|undefined} */
    #error;

    /** @type {unknown} */
    #instance;

    /** @type {boolean|undefined} */
    #unloaded;

    #defaults;

    /**
     * @param {{ entity: string, value: { path: string | URL } }} component
     * @param {Record<string, any>} [defaults]
     */
    constructor({ entity, value }, defaults) {
        super();

        if(defaults) {
            Object.assign(value, merge({}, defaults, value));
        }

        this.#entity   = entity;
        this.#value    = value;
        this.#path     = value.path.toString();
        this.#defaults = defaults;

        this.#load();
    }

    /**
     * @param {{ path: string | URL }} value
     */
    set(value) {
        const oldKey = this.key;

        if(this.#defaults) {
            Object.assign(value, merge({}, this.#defaults, value));
        }

        this.#value = value;
        this.#path  = this.#value.path.toString();

        if(oldKey !== this.key) {
            this.#load();
        }
    }

    toJSON() {
        return diff(this.#defaults ?? {}, this.#value);
    }

    get entity() {
        return this.#entity;
    }

    get value() {
        return this.#value;
    }

    get path() {
        return this.#path;
    }

    get referer() {
        return this.#referer;
    }

    get data() {
        return this.#getFromCache()?.data;
    }

    get instance() {
        return this.#instance;
    }

    get error() {
        return this.#error;
    }

    get key() {
        return this.path;
    }

    /**
     * @type {'error' | 'unloaded' | 'ready' | 'creating' | 'loading'}
     */
    get state() {
        if(this.#error) return 'error';
        if(this.#unloaded) return 'unloaded';
        if(this.#instance) return 'ready';
        if(this.data) return 'creating';
        return 'loading';
    }


    /**
     * @param {AbortSignal} [signal]
     */
    async fetch(signal) {
        return fetch(new URL(import.meta.resolve(this.path)), { signal });
    }

    /**
     * @param {AbortSignal} [signal]
     */
    async load(signal) {
        return (await this.fetch(signal)).json();
    }

    /**
     * Create a single instance for this asset. Will be called after the asset data is loaded from cache.
     */
    async createInstance() {
        return {}
    }

    /**
     * It will decrement the ref count for this path and if ref count is 0 the asset will be removed from the cache.
     */
    unload() {
        const assetRef = this.#getFromCache();
        if(!assetRef?.refs) return;

        assetRef.refs--;
        if(assetRef.refs === 0) {
            assetRef.abortCtl?.abort();
            this.#deleteFromCache();
        }

        this.#instance = null;
        this.#unloaded = true;
        this.notify('unload');
    }

    #getFromCache() {
        const cache = _cache.ensure(this.load, () =>  ({ assets: new Map() }));
        return /** @type {AssetRef}*/(cache.assets.get(this.key) ?? cache.assets.set(this.key, { refs: 0 }).get(this.key));
    }

    #deleteFromCache() {
        _cache.get(this.load)?.assets?.delete(this.key);
    }

    async #load() {
        try {
            const previous = this.#instance;

            if(previous) this.unload();

            this.#unloaded = false;

            const assetRef = this.#getFromCache();

            assetRef.refs++;

            if(!assetRef.pending && !assetRef.data) {
                assetRef.abortCtl = new AbortController();
                assetRef.pending  = this.load(assetRef.abortCtl.signal);
                assetRef.data     = await assetRef.pending;

                delete assetRef.pending;
                delete assetRef.abortCtl;
            }

            await (assetRef.pending ?? assetRef.data);
            this.notify('data:load', assetRef.data);

            this.#instance = await this.createInstance();

            this.notify('instance:create', { instance: this.#instance, previous });

            return assetRef.pending ?? assetRef.data;
        } catch(e) {
            if(e instanceof Error &&  e.name === 'AbortError'){
                this.#error = 'Aborted';
            } else {
                this.#error = 'Error loading Asset';
            }
            this.notify('error', this.#error);
        }
    }

    static clearCache() {
        this.abortAll();
        _cache.delete(this.prototype.load);
    }

    static abortAll() {
        const cache = _cache.get(this.prototype.load);
        if(cache?.assets) {
            for(const { abortCtl } of cache.assets.values()) {
                abortCtl?.abort();
            }
        }
    }
}
