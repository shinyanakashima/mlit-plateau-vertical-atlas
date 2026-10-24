import { useEffect, useRef, useState } from 'react'
import type { Atlas } from '../data/atlas'
import type { Lod } from '../data/types'
import { AtlasScene, type GridPick, type UpperMode } from './AtlasScene'

export interface Marker {
  index: number
  label: string
  color: string
  tp: number
}

export interface CesiumViewProps {
  atlas: Atlas | null
  lod: Lod
  elevation: number
  texture: HTMLCanvasElement | null
  sliceOpacity: number
  upperMode: UpperMode
  selectedBuilding: number | null
  markers: Marker[]
  path2d: number[] | null
  route3d: { cells: [number, number, number][] } | null
  showOrtho: boolean
  showBase: boolean
  onHover: (p: GridPick | null, x: number, y: number) => void
  onClick: (p: GridPick | null) => void
  onReady: (scene: AtlasScene) => void
  onModelError: (e: unknown) => void
}

export default function CesiumView(p: CesiumViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<AtlasScene | null>(null)
  const [scene, setScene] = useState<AtlasScene | null>(null)
  const cb = useRef(p)
  cb.current = p

  useEffect(() => {
    const s = new AtlasScene(host.current!)
    s.onHover = (g, pos) => cb.current.onHover(g, pos.x, pos.y)
    s.onClick = (g) => cb.current.onClick(g)
    s.onModelError = (e) => cb.current.onModelError(e)
    sceneRef.current = s
    setScene(s)
    cb.current.onReady(s)
    return () => {
      s.destroy()
      sceneRef.current = null
    }
  }, [])

  // atlas change: rebuild everything and fly to the area
  const lodRef = useRef(p.lod)
  lodRef.current = p.lod
  useEffect(() => {
    if (!scene || !p.atlas) return
    let alive = true
    scene.setAtlas(p.atlas, lodRef.current).then(() => {
      if (alive) scene.flyHome(0)
    })
    scene.setSliceElevation(cb.current.elevation)
    return () => { alive = false }
  }, [scene, p.atlas])

  useEffect(() => { if (scene && p.atlas) void scene.setLod(p.lod) }, [scene, p.atlas, p.lod])
  useEffect(() => { scene?.setSliceElevation(p.elevation) }, [scene, p.atlas, p.elevation])
  useEffect(() => { if (p.texture) scene?.setSliceTexture(p.texture) }, [scene, p.texture])
  useEffect(() => { scene?.setSliceOpacity(p.sliceOpacity) }, [scene, p.atlas, p.sliceOpacity])
  useEffect(() => { scene?.setUpperMode(p.upperMode) }, [scene, p.upperMode])
  useEffect(() => { scene?.setSelectedBuilding(p.selectedBuilding) }, [scene, p.selectedBuilding])
  useEffect(() => { scene?.setMarkers(p.markers) }, [scene, p.atlas, p.markers])
  useEffect(() => { scene?.setImagery(p.showOrtho, p.showBase) }, [scene, p.atlas, p.showOrtho, p.showBase])
  useEffect(() => {
    const a = p.atlas
    if (!scene || !a) return
    scene.setPaths(p.path2d, p.elevation, p.route3d ? { cells: p.route3d.cells, tpOf: (k) => a.levelCenter(k) } : null)
  }, [scene, p.atlas, p.path2d, p.route3d, p.elevation])

  return <div ref={host} className="cesium-host" />
}
