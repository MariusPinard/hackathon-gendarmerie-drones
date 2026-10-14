import {useEffect, useState} from 'react'
import type {AnalysisOptions, PolygonGeometry, SearchResponse} from '../types'

export interface ValidationCase {
  id:string; label:string; environment:string
  request:{operation_area:PolygonGeometry; options:Partial<AnalysisOptions>; max_candidates:number}
}

export default function ValidationCases({disabled, onPrepare, onSnapshot}: {
  disabled:boolean; onPrepare:(item:ValidationCase)=>void
  onSnapshot:(item:ValidationCase, result:SearchResponse)=>void
}) {
  const [cases,setCases] = useState<ValidationCase[]>([])
  const [selected,setSelected] = useState('urban')
  const [error,setError] = useState('')
  useEffect(()=> {fetch('/validation/v0.4/cases.json').then(r=>r.json()).then(setCases).catch(()=>setError('Cas de test indisponibles.'))},[])
  const item=cases.find(c=>c.id===selected)
  async function load() {
    setError('')
    try {
      const response=await fetch(`/validation/v0.4/${selected}.geojson`)
      if(!response.ok) throw new Error('Analyse enregistrée absente. Exécutez le script de validation.')
      const data:SearchResponse=await response.json()
      if(data.type!=='FeatureCollection'||data.metadata?.contract_version!=='0.4'||data.metadata.is_demo!==false) throw new Error('Capture incompatible ou analyse en erreur. Consultez le rapport.')
      if(item) onSnapshot(item,data)
    } catch(failure) {setError(failure instanceof Error?failure.message:'Chargement impossible.')}
  }
  return <details className="validation-cases"><summary>Examiner les six environnements · V0.4</summary>
    <p>Analyses réelles enregistrées, datées et non validées par un opérateur. Aucun recalcul lors de leur affichage.</p>
    <label>Environnement<select disabled={disabled} value={selected} onChange={e=>{setSelected(e.target.value);setError('')}}>{cases.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    <div className="case-actions"><button disabled={disabled||!item} onClick={()=>item&&onPrepare(item)}>Préparer une nouvelle analyse</button><button disabled={disabled||!item} onClick={load}>Afficher l’analyse enregistrée</button></div>
    {error&&<p role="alert">{error}</p>}
  </details>
}
