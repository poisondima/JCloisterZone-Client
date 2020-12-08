import fs from 'fs'
import path from 'path'
import Vue from 'vue'
import { remote } from 'electron'

import isString from 'lodash/isString'
import isObject from 'lodash/isObject'
import sortBy from 'lodash/sortBy'

import Location from '@/models/Location'

const FEATURE_ORDER = {
  N: 10,
  NW: 11,
  NE: 12,
  W: 20,
  SW: 21,
  E: 30,
  S: 40,
  SE: 41,
  TOWER: 50,
  CLOISTER: 51
}

const makeAbsPath = (prefix, path, artworkId = null) => {
  if (!path || path[0] === '/') {
    return path
  }
  if (path[0] === '#') {
    return `#${artworkId}-${path.substring(1)}`
  }
  return prefix + path
}

const forEachRotation = (obj, cb) => {
  for (let i = 0; i < 4; i++) {
    const prop = '@' + i
    const item = obj[prop]
    if (item) cb(item, prop)
  }
}

const makeAbsPathProp = (prefix, obj, prop, artworkId) => {
  if (isString(obj[prop])) {
    obj[prop] = makeAbsPath(prefix, obj[prop], artworkId)
  } else if (isObject(obj[prop])) {
    forEachRotation(obj[prop], (item, rot) => {
      obj[prop][rot] = makeAbsPath(prefix, item, artworkId)
    })
  }
}

class Theme {
  constructor (ctx) {
    this.artworks = {}
    this.tiles = {}
    this.tileLayers = {}
    this.ctx = ctx
  }

  async loadPlugins () {
    const { settings } = this.ctx.store.state

    const lookupFolders = [
      path.join(remote.app.getPath('userData'), 'artworks'),
      __resources + '/artworks/'
    ]

    async function readArtwork (id, fullPath) {
      const stats = await fs.promises.stat(fullPath)
      if (stats.isDirectory()) {
        const jsonPath = path.join(fullPath, 'artwork.json')
        try {
          await fs.promises.access(jsonPath, fs.constants.R_OK)
          return {
            id,
            folder: fullPath,
            jsonFile: jsonPath
          }
        } catch (e) {
          // not plugin folder, do nothing
        }
      }
      return null
    }

    const installedArtworks = []
    const installedArtworksIds = new Set()

    for (const fullPath of settings.userArtworks) {
      const artwork = await readArtwork(path.basename(fullPath), fullPath)
      if (artwork && !installedArtworksIds.has(artwork.id)) {
        installedArtworks.push(artwork)
        installedArtworksIds.add(artwork.id)
      }
    }

    for (const lookupFolder of lookupFolders) {
      let listing
      try {
        listing = await fs.promises.readdir(lookupFolder)
      } catch (e) {
        console.log(`${lookupFolder} does not exist`)
        continue
      }
      for (const id of listing) {
        // when same artwok is on path twice, register first found
        // this allowes overide from user path
        if (!installedArtworksIds.has(id)) {
          const fullPath = path.join(lookupFolder, id)
          const artwork = await readArtwork(id, fullPath)
          if (artwork) {
            installedArtworks.push(artwork)
            installedArtworksIds.add(id)
          }
        }
      }
    }

    let resourcesContainer = document.getElementById('theme-resources')
    if (resourcesContainer) {
      resourcesContainer.innerHTML = ''
    } else {
      resourcesContainer = document.createElement('div')
      resourcesContainer.setAttribute('id', 'theme-resources')
      document.body.appendChild(resourcesContainer)
    }

    // console.log('Installed artworks: ', installedArtworks)
    this.installedArtworks = installedArtworks
    await this.loadArtworks()
  }

  async loadArtworks () {
    this._artworks = {}
    this._tiles = {}

    const { settings } = this.ctx.store.state

    for (const id of settings.enabledArtworks) {
      const artwork = this.installedArtworks.find(a => a.id === id)
      if (artwork) {
        await this.loadArtwork(artwork)
      }
    }

    this.artworks = this._artworks
    this.tiles = this._tiles
    this.tileLayers = {}
    delete this._artwork
    delete this._tiles
  }

  async loadArtwork ({ id, folder, jsonFile }) {
    const artwork = this._artworks[id] = JSON.parse(await fs.promises.readFile(jsonFile))
    const artworkRootDir = path.dirname(jsonFile)
    const pathPrefix = `file:///${folder}/`

    artwork.symbols = {}
    artwork.features = artwork.features || {}
    artwork.tiles = artwork.tiles || {}
    artwork.tileSize = parseInt(artwork['tile-size']) || 1000
    delete artwork['tile-size']

    if (artwork.tileSize === 1000) {
      artwork.scaleTransform = ''
    } else {
      const s = 1000 / artwork.tileSize
      artwork.scaleTransform = `scale(${s} ${s})`
    }

    for (const res of artwork.resources || []) {
      if (path.extname(res) !== '.svg') {
        console.error('Only SVG resources are allowed')
        continue
      }
      const content = await fs.promises.readFile(path.join(artworkRootDir, res))
      const parser = new DOMParser()
      const doc = parser.parseFromString(content, 'image/svg+xml')
      doc.querySelectorAll('symbol').forEach(el => {
        const symbolId = `${id}-${el.getAttribute('id')}`
        el.setAttribute('id', symbolId)
        const [w, h] = el.getAttribute('viewBox').split(' ').slice(2).map(val => parseInt(val))
        artwork.symbols[symbolId] = { size: [w, h] }
      })
      doc.querySelectorAll('image').forEach(el => el.setAttribute('href', pathPrefix + el.getAttribute('href')))
      document.getElementById('theme-resources').innerHTML = doc.documentElement.outerHTML
    }

    artwork.id = id
    if (artwork.background) {
      artwork.background.image = makeAbsPath(pathPrefix, artwork.background.image)
      // TODO preload background
    }

    const processFeature = (featureId, data) => {
      data.id = featureId
      if (isString(data.image)) data.image = makeAbsPath(pathPrefix, data.image, id)
      if (data.image && data.image.href) data.image.href = makeAbsPath(pathPrefix, data.image.href, id)
      if (data.images) {
        for (let i = 0; i < data.images.length; i++) {
          if (isString(data.images[i])) data.images[i] = makeAbsPath(pathPrefix, data.images[i], id)
          if (data.images[i] && data.images[i].href) data.images[i].href = makeAbsPath(pathPrefix, data.images[i].href, id)
        }
      }
      forEachRotation(data, item => {
        if (isString(item.image)) item.image = makeAbsPath(pathPrefix, item.image, id)
        if (item.image && item.image.href) item.image.href = makeAbsPath(pathPrefix, item.image.href, id)
        if (item.images) {
          for (let i = 0; i < item.images.length; i++) {
            if (isString(item.images[i])) item.images[i] = makeAbsPath(pathPrefix, item.images[i], id)
            if (item.images[i] && item.images[i].href) item.images[i].href = makeAbsPath(pathPrefix, item.images[i].href, id)
          }
        }
      })
    }

    Object.entries(artwork.features).forEach(([featureId, data]) => processFeature(featureId, data))
    for (const fname of artwork['features-include'] || []) {
      const content = JSON.parse(await fs.promises.readFile(path.join(artworkRootDir, fname)))
      Object.entries(content).forEach(([featureId, data]) => {
        processFeature(featureId, data)
        artwork.features[featureId] = data
      })
    }

    const processTile = (tileId, data) => {
      if (this._tiles[tileId]) {
        // tile already registred by prev artwork
        // currently there is time load fixed order
        return
      }

      const tile = {
        id: tileId,
        rotation: data.rotation,
        artwork,
        features: {}
      }

      if (data.image) {
        if (data.image.href) {
          makeAbsPathProp(pathPrefix, data.image, 'href', id)
          tile.image = data.image
        } else {
          makeAbsPathProp(pathPrefix, data, 'image', id)
          tile.image = data.image
        }
      }

      Object.entries(data.features).forEach(([loc, f]) => {
        if (isString(f)) {
          f = artwork.features[f]
        } else if (isObject(f)) {
          if (f.id) {
            const sharedFeature = artwork.features[f.id]
            Object.assign(f, sharedFeature)
          }
        }
        tile.features[loc] = f
      })

      this._tiles[tileId] = tile
    }

    Object.entries(artwork.tiles).forEach(([tileId, data]) => processTile(tileId, data))
    for (const fname of artwork['tiles-include'] || []) {
      const content = JSON.parse(await fs.promises.readFile(path.join(artworkRootDir, fname)))
      Object.entries(content).forEach(([tileId, data]) => processTile(tileId, data))
    }

    delete artwork.features
    delete artwork.tiles

    console.log(`Loaded artwork '${id}' from ${folder}`)
  }

  getArtwork (artworkId) {
    return this.artworks[artworkId]
  }

  getTileArtwork (tileId) {
    const tile = this.getTile(tileId)
    return tile ? tile.artwork : null
  }

  getTile (id) {
    const tile = this.tiles[id]
    if (!tile) {
      console.warn(`Tile ${id} is not registered`)
    }
    return tile
  }

  getFeature ({ id, position, rotation }, loc, bridges = []) {
    const bridge = bridges.find(b => b.position[0] === position[0] && b.position[1] === position[1])
    if (bridge && loc === bridge.location) {
      return {
        clip: 'M 0 600 L 0 400 L 1000 400 L 1000 600 L 850 600 C 850 435 150 435 150 600 Z',
        point: [750, 500],
        rotation: loc === 'NS' ? 90 : 0,
        bridge: true
      }
    }

    if (loc === 'MONASTERY') {
      loc = 'CLOISTER'
    } else if (rotation !== 0) {
      loc = Location.parse(loc).rotateCCW(rotation).name
    }

    // console.log(bridges)
    const tile = this.getTile(id)
    let feature = tile.features[loc]

    if (!feature) {
      throw new Error(`Can't find feature for ${id} ${loc}`)
    }

    let r = feature.rotation || 0
    if (tile.artwork.perspective === 'rotate') {
      r = (r + rotation) % 360
    } else {
      const rotKey = '@' + (rotation / 90)
      if (feature[rotKey]) {
        feature = feature[rotKey]
      }
    }

    return {
      clip: feature.clip,
      point: feature.point,
      transform: feature.transform,
      rotation: r
    }
  }

  _createTileLayer (artwork, image, featureTransform, perspective, rotation) {
    let href
    if (image.href) {
      href = image.href
    } else {
      href = image
    }

    const svgRef = href[0] === '#' || href.includes('.svg#')
    let width = artwork.tileSize
    let height = artwork.tileSize
    const x = image.x || 0
    const y = image.y || 0

    if (svgRef) {
      const size = artwork.symbols[href.substring(1)]?.size
      if (size === undefined) {
        console.warn(`Size symbol is missing for ${href}`)
      } else {
        width = size[0]
        height = size[1]
      }
    }

    const layer = {
      tag: svgRef ? 'use' : 'image',
      props: { x, y, width, height, href },
      zindex: image.zindex || 1
    }

    const transform = []
    if (perspective === 'rotate' && rotation) {
      transform.push(`rotate(${rotation} ${artwork.tileSize / 2} ${artwork.tileSize / 2})`)
    }
    if (featureTransform) {
      transform.push(featureTransform)
    }
    if (image.transform) {
      transform.push(image.transform)
    }
    if (transform.length) {
      layer.props.transform = transform.join(' ')
    }

    return layer
  }

  getTileLayers (id, rotation) {
    const cacheKey = `${id}@${rotation}`
    const cachedValue = this.tileLayers[cacheKey]
    if (cachedValue) {
      return cachedValue
    }

    const tile = this.getTile(id)
    if (!tile) {
      throw new Error(`Unknown tile id ${id}`)
    }

    const getRecordForRotation = (obj, rotation) => {
      const rotKey = '@' + (rotation / 90)
      if (obj && obj[rotKey]) {
        obj = obj[rotKey]
      }
      return obj
    }

    const { artwork } = tile
    let layers = []

    if (tile.image) {
      const image = getRecordForRotation(tile.image, rotation)
      if (isString(image) || image.href) {
        const layer = this._createTileLayer(artwork, image, null, artwork.perspective, rotation)
        layer.order = 1
        layers.push(layer)
      }
    }

    Object.entries(tile.features).forEach(([loc, f]) => {
      const perspective = f.perspective || artwork.perspective
      let r = rotation
      if (f.rotate) {
        r = (r + f.rotate) % 360
      }

      f = getRecordForRotation(f, r)

      const processImage = (image, t) => {
        const order = FEATURE_ORDER[loc]
        const layer = this._createTileLayer(artwork, image, f.transform, perspective, r)
        layer.order = order === undefined ? 9 : order
        layers.push(layer)
      }

      if (f.image) {
        processImage(f.image)
      }
      if (f.images) {
        for (const img of f.images) {
          processImage(img)
        }
      }
    })

    layers = sortBy(layers, 'order')
    layers = sortBy(layers, 'zindex')
    layers.forEach(layer => { delete layer.order })

    return (this.tileLayers[cacheKey] = {
      artwork,
      layers
    })
  }
}

export default (ctx, inject) => {
  let theme = null

  Object.defineProperty(Vue.prototype, '$theme', {
    get () {
      if (theme === null) {
        theme = new Theme(ctx)
      }
      return theme
    }
  })
}
