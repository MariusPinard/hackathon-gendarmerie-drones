export interface PolygonGeometry {
  type: 'Polygon'
  coordinates: number[][][]
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon'
  coordinates: number[][][][]
}

export type SurfaceGeometry = PolygonGeometry | MultiPolygonGeometry
export type RelevanceLevel = 'high' | 'moderate' | 'low'

export interface Criterion {
  key: string
  label: string
  score: number | null
  weight: number
  source: string
  value: number | null
  unit: string | null
  explanation: string
}

export interface Candidate {
  type: 'Feature'
  id: string
  geometry: SurfaceGeometry
  properties: {
    name: string
    surface_type: 'ground' | 'rooftop'
    score_profile: 'ground_v1' | 'rooftop_v1'
    roof: null | {surface_elevation_m:number; height_above_ground_m:number; slope_deg:number; sample_spacing_m:number; surface_samples:number; roughness_m:number; equipment_status:'suspected'|'not_resolved'; access_status:'mapped'|'unknown'; checks_required:string[]}
    is_demo: false
    score: number
    score_kind: 'measured_heuristic'
    uncertainty: 'medium' | 'high'
    evidence_coverage: number
    missing_data: string[]
    evidence: string[]
    source_ids: string[]
    visibility_estimate: {
      status: 'not_assessed' | 'terrain_only' | 'surface_model'
      clear_fraction: number | null
      evaluated_rays: number
      blocked_rays: number
      unknown_rays: number
      observer_height_m: number
      target_height_agl_m: number
      sampling_m: number | null
      explanation: string
    }
    ground_photos: { id: string; url: string; thumbnail_url: string | null; license_url: string; attribution: string; captured_at: string | null; distance_m: number }[]
    area_m2: number
    area_method: 'geodesic_wgs84'
    component_count: number
    relevance_level: RelevanceLevel
    criteria: Criterion[]
    justifications: string[]
    pilot_position: null
    takeoff_position: { type: 'Point'; coordinates: [number, number] } | null
    visibility: 'not_assessed'
    radio_link: 'not_assessed'
  }
}

export type OccupancyStatus = 'free' | 'free_unconfirmed' | 'limited_range' | 'no_access' | 'masked' |
  'out_of_range' | 'steep' | 'obstacle_buffer' | 'occupied'
export type TakeoffVerdict = 'possible' | 'conditional' | 'impossible'

export interface OccupancyZone {
  status: OccupancyStatus
  reason: string | null
  label: string
  reason_label: string | null
  takeoff: TakeoffVerdict
  area_m2: number
  geometry: MultiPolygonGeometry
}

export interface OccupancyMap {
  kind: 'takeoff_occupancy'
  cell_size_m: number
  rows: number
  cols: number
  cells_evaluated: number
  pilot_range_m: number
  zones: OccupancyZone[]
  area_by_status_m2: Partial<Record<OccupancyStatus, number>>
  share_by_status: Partial<Record<OccupancyStatus, number>>
  assessed: Record<string, boolean>
  notes: string[]
}

/** Static area-wide map produced by scripts/build_commune_occupancy.py. */
export interface CommuneOccupancy {
  kind: 'commune_takeoff_occupancy'
  commune: { name: string; insee: string; department: string | null; area_m2: number; geometry: SurfaceGeometry }
  generated_at: string
  elapsed_seconds: number
  tile_size_m: number
  tiles: { total: number; failed: { tile: number; error: string }[] }
  sources: SourceReport[]
  occupancy: OccupancyMap
}

export interface SearchResponse {
  type: 'FeatureCollection'
  features: Candidate[]
  /** Absent from captures recorded before the occupancy map. */
  occupancy?: OccupancyMap | null
  metadata: {
    contract_version: '0.4'
    candidate_kind: 'pilot_zone'
    mode: 'analysis'
    is_demo: false
    provider: 'open_geodata'
    status: 'complete' | 'partial' | 'no_candidates'
    sources: SourceReport[]
    search_area: SurfaceGeometry
    terrain_sampling_m: number | null
    options: AnalysisOptions
    count: number
    requested_count: number
    warnings: string[]
    limitations: string[]
    elapsed_seconds: number
    phase_seconds: Record<string,number>
    diagnostics: Record<string,number|string>
    validation_status: 'awaiting_operator_review'
  }
}

export interface SourceReport {
  id: string; name: string; url: string; license: string; attribution: string
  status: 'available' | 'partial' | 'unavailable' | 'disabled'
  fetched_at: string | null; acquisition_date: string | null; feature_count: number; detail: string
}

export interface AnalysisOptions {
  search_radius_m: number
  surroundings_only: boolean
  min_area_m2: number
  min_width_m: number
  obstacle_buffer_m: number
  max_access_distance_m: number
  max_slope_deg: number
  terrain_spacing_m: number
  target_height_agl_m: number
  require_terrain: boolean
  include_ground: boolean; include_rooftops: boolean
  roof_edge_setback_m: number; max_roof_slope_deg: number; roof_sample_spacing_m: number
  roof_shortlist_limit: number
  include_occupancy: boolean; pilot_range_m: number; occupancy_cell_m: number
  use_osm: boolean; use_ign: boolean; use_imagery: boolean; use_lidar: boolean; use_panoramax: boolean
  weights: Record<string, number>
}
