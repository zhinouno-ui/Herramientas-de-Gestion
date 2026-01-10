
import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// ==========================================
// 1. CONFIGURACIÓN Y TIPOS
// ==========================================

enum ContactStatus {
  SIN_REVISAR = 'sin revisar',
  JUGANDO = 'jugando',
  CONTACTADO = 'contactado',
  NO_INTERESADO = 'no interesado',
  SIN_WSP = 'sin wsp'
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  origin: string;
  status: ContactStatus;
  seenReplied: boolean;
  recovered: boolean;
  interested: boolean;
  lastUpdated: number;
}

const STATUS_CONFIG: Record<ContactStatus, any> = {
  [ContactStatus.SIN_REVISAR]: { label: 'Sin Revisar', color: 'bg-slate-500', borderColor: 'border-slate-500', textColor: 'text-slate-400', icon: 'fa-clock' },
  [ContactStatus.JUGANDO]: { label: 'Jugando', color: 'bg-purple-600', borderColor: 'border-purple-600', textColor: 'text-purple-400', icon: 'fa-gamepad' },
  [ContactStatus.CONTACTADO]: { label: 'Contactado', color: 'bg-emerald-500', borderColor: 'border-emerald-500', textColor: 'text-emerald-400', icon: 'fa-check' },
  [ContactStatus.NO_INTERESADO]: { label: 'No Interesado', color: 'bg-rose-500', borderColor: 'border-rose-500', textColor: 'text-rose-400', icon: 'fa-times' },
  [ContactStatus.SIN_WSP]: { label: 'Sin WSP', color: 'bg-gray-600', borderColor: 'border-gray-600', textColor: 'text-gray-400', icon: 'fa-ban' }
};

// ==========================================
// 2. PARSERS (CSV / VCF)
// ==========================================

const parseCSV = (csvText: string): Contact[] => {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];
  
  // Limpiamos cabeceras
  const headers = lines[0].toLowerCase().split(',').map(h => h.replace(/"/g, '').trim());
  const idxUser = headers.indexOf('usuarios');
  const idxRevStatus = headers.indexOf('estado de revision');
  const idxActualStatus = headers.indexOf('estado actual');
  const idxInterested = headers.indexOf('interesado en jugar?');

  if (idxUser === -1) return [];

  return lines.slice(1).map(line => {
    // Manejo de comas dentro de comillas si fuera necesario, pero simplificado para tu formato
    const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
    const name = cols[idxUser];
    
    if (!name || name.toLowerCase() === 'eliminado' || name === '') return null;

    const rawRevStatus = cols[idxRevStatus]?.toLowerCase() || '';
    const rawActualStatus = cols[idxActualStatus]?.toLowerCase() || '';
    const rawInterested = cols[idxInterested]?.toLowerCase() || '';

    let status = ContactStatus.SIN_REVISAR;

    // PRIORIDAD DE ESTADOS SEGUN PLANILLA
    if (rawInterested === 'no') {
      status = ContactStatus.NO_INTERESADO;
    } else if (rawRevStatus.includes('cargando')) {
      status = ContactStatus.JUGANDO;
    } else if (rawActualStatus.includes('contacto') || rawActualStatus.includes('en contacto')) {
      status = ContactStatus.CONTACTADO;
    } else if (rawRevStatus.includes('no esta en wsp')) {
      status = ContactStatus.SIN_WSP;
    }

    return {
      id: crypto.randomUUID(),
      name: name,
      phone: '', // La planilla no trae el numero en la col principal
      origin: 'PLANILLA',
      status,
      seenReplied: cols[4]?.toUpperCase() === 'SI',
      recovered: cols[5]?.toUpperCase() === 'SI',
      interested: rawInterested === 'si',
      lastUpdated: Date.now()
    };
  }).filter(c => c !== null) as Contact[];
};

const parseVCF = (vcfText: string): Contact[] => {
  const contacts: Contact[] = [];
  vcfText.split(/END:VCARD/i).forEach(block => {
    if (!block.includes('BEGIN:VCARD')) return;
    const name = block.match(/FN:(.+)/i)?.[1].trim() || 'Sin nombre';
    const phone = block.match(/TEL[^:]*:(.+)/i)?.[1].replace(/\D/g, '') || '';
    contacts.push({
      id: crypto.randomUUID(),
      name,
      phone,
      origin: 'PC',
      status: ContactStatus.SIN_REVISAR,
      seenReplied: false, recovered: false, interested: false,
      lastUpdated: Date.now()
    });
  });
  return contacts;
};

// ==========================================
// 3. APP PRINCIPAL
// ==========================================

const App: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [viewMode, setViewMode] = useState<'cards' | 'list' | 'tinder'>('cards');
  const [currentFilter, setCurrentFilter] = useState<ContactStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [tinderIndex, setTinderIndex] = useState(0);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('gestor_final_v3');
    if (saved) setContacts(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('gestor_final_v3', JSON.stringify(contacts));
  }, [contacts]);

  const stats = useMemo(() => {
    const s: Record<string, number> = { total: contacts.length };
    (Object.values(ContactStatus) as ContactStatus[]).forEach(v => {
      s[v] = contacts.filter(c => c.status === v).length;
    });
    return s;
  }, [contacts]);

  const filtered = useMemo(() => {
    return contacts.filter(c => {
      const fMatch = currentFilter === 'all' || c.status === currentFilter;
      const sMatch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone.includes(searchTerm);
      return fMatch && sMatch;
    });
  }, [contacts, currentFilter, searchTerm]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>, type: 'csv' | 'vcf') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const newData = type === 'csv' ? parseCSV(text) : parseVCF(text);
    
    setContacts(prev => {
      // Unificamos priorizando la nueva data si el nombre coincide
      const map = new Map(prev.map(c => [c.name.toLowerCase(), c]));
      newData.forEach(n => {
        const key = n.name.toLowerCase();
        if (map.has(key)) {
          // Si existe, actualizamos solo lo necesario pero mantenemos el ID si ya tenia telefono de VCF
          const existing = map.get(key)!;
          map.set(key, { ...existing, ...n, id: existing.id, phone: existing.phone || n.phone });
        } else {
          map.set(key, n);
        }
      });
      return Array.from(map.values());
    });
    setIsImportOpen(false);
  };

  const exportCSV = () => {
    const headers = ["usuarios", "estado de revision", "", "estado actual", "VISTO, RESPONDIDO?", "RECUPERADO", "TURNO DE LAS CARGAS", "interesado en jugar?", "ya contactados", "recuperados!", "actualmente cargando", "TURNO MAÑANA", "TURNO TARDE", "TURNO NOCHE", "contactos a borrar"];
    const contactados = contacts.filter(c => c.status === ContactStatus.CONTACTADO).map(c => c.name);
    const recuperados = contacts.filter(c => c.recovered).map(c => c.name);
    const cargando = contacts.filter(c => c.status === ContactStatus.JUGANDO).map(c => c.name);

    const rows = contacts.map((c, i) => [
      c.name,
      c.status === ContactStatus.SIN_WSP ? "no esta en wsp" : (c.status === ContactStatus.JUGANDO ? "esta cargando" : "promo enviada"),
      "",
      c.status === ContactStatus.CONTACTADO || c.status === ContactStatus.JUGANDO ? "EN CONTACTO" : (c.status === ContactStatus.SIN_WSP ? "NO ESTA EN WSP" : "MENSAJE ENVIADO"),
      c.seenReplied ? "SI" : "NO",
      c.recovered ? "SI" : "NO",
      "",
      c.status === ContactStatus.NO_INTERESADO ? "NO" : "SI",
      contactados[i] || "",
      recuperados[i] || "",
      cargando[i] || "",
      "", "", "", ""
    ].join(','));

    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `planilla_export.csv`;
    link.click();
  };

  const exportVCF = () => {
    const vcf = contacts.map(c => `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\nTEL;TYPE=CELL:${c.phone}\nNOTE:Status:${c.status}\nEND:VCARD`).join('\n\n');
    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `contactos.vcf`;
    link.click();
  };

  // Fix: Defined saveEdit to handle form submission for updating contacts
  const saveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editContact) return;
    setContacts(prev => prev.map(c => c.id === editContact.id ? { ...editContact, lastUpdated: Date.now() } : c));
    setEditContact(null);
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 max-w-6xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">GESTOR PRO V3</h1>
          <p className="text-slate-500 text-xs font-bold uppercase">Planilla Máxima Compatibilidad</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={() => setIsImportOpen(true)} className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2">
            <i className="fas fa-file-import"></i> IMPORTAR
          </button>
          <div className="relative group flex-1 md:flex-none">
            <button className="w-full bg-emerald-600 hover:bg-emerald-500 px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2">
              <i className="fas fa-download"></i> EXPORTAR
            </button>
            <div className="absolute top-full right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <button onClick={exportCSV} className="w-full p-4 text-left hover:bg-slate-700 rounded-t-2xl flex items-center gap-2"><i className="fas fa-file-csv text-blue-400"></i> Planilla (CSV)</button>
              <button onClick={exportVCF} className="w-full p-4 text-left hover:bg-slate-700 rounded-b-2xl flex items-center gap-2"><i className="fas fa-address-book text-emerald-400"></i> Contactos (VCF)</button>
            </div>
          </div>
          <button onClick={() => confirm('¿Borrar todo?') && setContacts([])} className="bg-slate-800 hover:bg-rose-900 px-4 py-3 rounded-2xl text-slate-500 hover:text-white"><i className="fas fa-trash"></i></button>
        </div>
      </header>

      {/* Filtros de progreso */}
      <section className="bg-slate-800/40 border border-slate-700/50 p-6 rounded-3xl mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-6">
          <button onClick={() => setCurrentFilter('all')} className={`p-4 rounded-2xl border transition-all ${currentFilter === 'all' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-600'}`}>
            <div className="text-2xl font-black text-blue-400">{stats.total}</div>
            <div className="text-[10px] text-slate-500 font-bold uppercase">TOTAL</div>
          </button>
          {(Object.values(ContactStatus) as ContactStatus[]).map(s => (
            <button key={s} onClick={() => setCurrentFilter(s)} className={`p-4 rounded-2xl border transition-all ${currentFilter === s ? STATUS_CONFIG[s].borderColor + ' bg-slate-700' : 'border-slate-700 hover:border-slate-600'}`}>
              <div className={`text-2xl font-black ${STATUS_CONFIG[s].textColor}`}>{stats[s]}</div>
              <div className="text-[10px] text-slate-500 font-bold uppercase">{STATUS_CONFIG[s].label}</div>
            </button>
          ))}
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden flex">
          {(Object.values(ContactStatus) as ContactStatus[]).map(s => (
            <div key={s} style={{ width: `${stats.total ? (stats[s]/stats.total)*100 : 0}%` }} className={`${STATUS_CONFIG[s].color} h-full transition-all duration-500`} />
          ))}
        </div>
      </section>

      {/* Busqueda y Vistas */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="bg-slate-800 p-1.5 rounded-2xl border border-slate-700 flex flex-1 md:flex-none">
          <button onClick={() => setViewMode('cards')} className={`flex-1 px-6 py-2 rounded-xl font-bold ${viewMode === 'cards' ? 'bg-blue-600 shadow-lg' : 'text-slate-500'}`}>CARDS</button>
          <button onClick={() => setViewMode('list')} className={`hidden md:block px-6 py-2 rounded-xl font-bold ${viewMode === 'list' ? 'bg-blue-600 shadow-lg' : 'text-slate-500'}`}>LISTA</button>
          <button onClick={() => setViewMode('tinder')} className={`flex-1 px-6 py-2 rounded-xl font-bold ${viewMode === 'tinder' ? 'bg-rose-600 shadow-lg' : 'text-slate-500'}`}><i className="fas fa-fire mr-2"></i>REVISIÓN</button>
        </div>
        <div className="relative flex-1">
          <i className="fas fa-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-500"></i>
          <input type="text" placeholder="Buscar por nombre..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-slate-800 border border-slate-700 py-4 pl-14 pr-6 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <main className="flex-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 opacity-30 text-center">
            <i className="fas fa-users-slash text-8xl mb-4"></i>
            <h2 className="text-2xl font-black">VACÍO</h2>
          </div>
        ) : (
          <>
            {viewMode === 'cards' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(c => (
                  <div key={c.id} className={`bg-slate-800 p-6 rounded-3xl border-l-4 ${STATUS_CONFIG[c.status].borderColor} shadow-xl`}>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-black text-xl text-white truncate max-w-[180px]">{c.name}</h3>
                      <div className="flex gap-1">
                        <button onClick={() => setEditContact(c)} className="p-2 text-slate-500 hover:text-blue-400"><i className="fas fa-edit"></i></button>
                        <button onClick={() => confirm('¿Borrar?') && setContacts(prev => prev.filter(x => x.id !== c.id))} className="p-2 text-slate-500 hover:text-rose-500"><i className="fas fa-trash"></i></button>
                      </div>
                    </div>
                    <div className="mb-4 text-slate-500 text-[10px] font-bold uppercase">{c.origin}</div>
                    <div className="mb-6 font-mono text-slate-400 text-sm">{c.phone || 'Sin número'}</div>
                    <div className="grid grid-cols-2 gap-2 mb-6">
                      {(Object.values(ContactStatus) as ContactStatus[]).map(s => (
                        <button key={s} onClick={() => setContacts(prev => prev.map(x => x.id === c.id ? {...x, status: s, lastUpdated: Date.now()} : x))} className={`text-[10px] font-bold py-1.5 rounded-lg border transition-all ${c.status === s ? STATUS_CONFIG[s].color + ' border-transparent text-white' : 'border-slate-700 text-slate-500 hover:bg-slate-700'}`}>
                          {STATUS_CONFIG[s].label}
                        </button>
                      ))}
                    </div>
                    {c.phone && <a href={`https://wa.me/${c.phone}`} target="_blank" className="w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded-2xl font-black flex items-center justify-center gap-2"><i className="fab fa-whatsapp"></i> WhatsApp</a>}
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'list' && (
              <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden overflow-x-auto">
                <table className="w-full text-left min-w-[600px]">
                  <thead>
                    <tr className="bg-slate-900/50 text-[10px] text-slate-500 uppercase font-black border-b border-slate-700">
                      <th className="px-6 py-4">Usuario</th>
                      <th className="px-6 py-4">Teléfono</th>
                      <th className="px-6 py-4">Estado</th>
                      <th className="px-6 py-4 text-right">Opciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {filtered.map(c => (
                      <tr key={c.id} className="hover:bg-slate-700/30">
                        <td className="px-6 py-4"><div className="font-bold">{c.name}</div><div className="text-[10px] text-slate-500">{c.origin}</div></td>
                        <td className="px-6 py-4 font-mono text-sm">{c.phone || '-'}</td>
                        <td className="px-6 py-4">
                          <select value={c.status} onChange={e => setContacts(prev => prev.map(x => x.id === c.id ? {...x, status: e.target.value as ContactStatus, lastUpdated: Date.now()} : x))} className={`bg-transparent text-xs font-bold border rounded-lg px-2 py-1 ${STATUS_CONFIG[c.status].borderColor} ${STATUS_CONFIG[c.status].textColor}`}>
                            {(Object.values(ContactStatus) as ContactStatus[]).map(s => <option key={s} value={s} className="bg-slate-800">{STATUS_CONFIG[s].label}</option>)}
                          </select>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            {c.phone && <a href={`https://wa.me/${c.phone}`} target="_blank" className="text-emerald-400 p-2"><i className="fab fa-whatsapp"></i></a>}
                            <button onClick={() => setEditContact(c)} className="text-blue-400 p-2"><i className="fas fa-edit"></i></button>
                            <button onClick={() => confirm('¿Borrar?') && setContacts(prev => prev.filter(x => x.id !== c.id))} className="text-rose-400 p-2"><i className="fas fa-trash"></i></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {viewMode === 'tinder' && (
              <div className="flex flex-col items-center max-w-sm mx-auto">
                <div className={`w-full bg-slate-800 p-8 rounded-[2.5rem] border-t-8 ${filtered[tinderIndex] ? STATUS_CONFIG[filtered[tinderIndex].status].borderColor : 'border-slate-700'} shadow-2xl relative`}>
                  <div className="absolute top-6 right-8 text-slate-600 font-black text-xs">{tinderIndex + 1} / {filtered.length}</div>
                  <div className="mb-8">
                    <h2 className="text-4xl font-black break-words leading-none">{filtered[tinderIndex]?.name}</h2>
                    <p className="text-slate-500 text-xs font-bold mt-2 uppercase">{filtered[tinderIndex]?.origin}</p>
                  </div>
                  <div className="bg-slate-900/50 p-6 rounded-3xl mb-8 border border-slate-700 text-center">
                    <p className="text-[10px] font-black text-slate-600 uppercase mb-1">Teléfono</p>
                    <p className="text-2xl font-mono text-white tracking-widest">{filtered[tinderIndex]?.phone || 'SIN NÚMERO'}</p>
                  </div>
                  {filtered[tinderIndex]?.phone && (
                    <a href={`https://wa.me/${filtered[tinderIndex].phone}`} target="_blank" className="w-full bg-emerald-600 py-5 rounded-2xl font-black text-lg mb-8 flex items-center justify-center gap-3 active:scale-95 transition-all"><i className="fab fa-whatsapp text-3xl"></i> WhatsApp</a>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { setContacts(prev => prev.map(x => x.id === filtered[tinderIndex].id ? {...x, status: ContactStatus.JUGANDO, lastUpdated: Date.now()} : x)); setTinderIndex(i => (i + 1) % filtered.length); }} className="bg-purple-600 py-4 rounded-2xl font-black text-xs active:scale-95 transition-all">JUGANDO</button>
                    <button onClick={() => { setContacts(prev => prev.map(x => x.id === filtered[tinderIndex].id ? {...x, status: ContactStatus.CONTACTADO, lastUpdated: Date.now()} : x)); setTinderIndex(i => (i + 1) % filtered.length); }} className="bg-emerald-500 py-4 rounded-2xl font-black text-xs active:scale-95 transition-all">CONTACTADO</button>
                    <button onClick={() => { setContacts(prev => prev.map(x => x.id === filtered[tinderIndex].id ? {...x, status: ContactStatus.NO_INTERESADO, lastUpdated: Date.now()} : x)); setTinderIndex(i => (i + 1) % filtered.length); }} className="bg-rose-500 py-4 rounded-2xl font-black text-xs active:scale-95 transition-all">NO INTERÉS</button>
                    <button onClick={() => { setContacts(prev => prev.map(x => x.id === filtered[tinderIndex].id ? {...x, status: ContactStatus.SIN_WSP, lastUpdated: Date.now()} : x)); setTinderIndex(i => (i + 1) % filtered.length); }} className="bg-slate-600 py-4 rounded-2xl font-black text-xs active:scale-95 transition-all">SIN WSP</button>
                  </div>
                  <div className="flex justify-between mt-10 text-slate-500 font-black text-[10px] uppercase pt-4 border-t border-slate-700">
                    <button disabled={tinderIndex === 0} onClick={() => setTinderIndex(i => i - 1)} className="disabled:opacity-20 flex items-center gap-2"><i className="fas fa-arrow-left"></i> Anterior</button>
                    <button onClick={() => setTinderIndex(i => (i + 1) % filtered.length)} className="flex items-center gap-2">Siguiente <i className="fas fa-arrow-right"></i></button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Modals */}
      {isImportOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => setIsImportOpen(false)}></div>
          <div className="relative bg-slate-800 border border-slate-700 p-8 rounded-[3rem] w-full max-md shadow-2xl">
            <h2 className="text-3xl font-black mb-8 text-center uppercase tracking-widest">Importar</h2>
            <div className="space-y-4">
              <div className="relative border-2 border-dashed border-slate-700 p-8 rounded-3xl hover:border-blue-500 text-center cursor-pointer transition-all group">
                <input type="file" accept=".csv" onChange={e => handleImport(e, 'csv')} className="absolute inset-0 opacity-0 cursor-pointer" />
                <i className="fas fa-file-csv text-4xl text-blue-400 mb-2 group-hover:scale-110 transition-all"></i>
                <p className="font-black text-slate-300 uppercase text-xs">Planilla de Sheets</p>
              </div>
              <div className="relative border-2 border-dashed border-slate-700 p-8 rounded-3xl hover:border-emerald-500 text-center cursor-pointer transition-all group">
                <input type="file" accept=".vcf,.vcard" onChange={e => handleImport(e, 'vcf')} className="absolute inset-0 opacity-0 cursor-pointer" />
                <i className="fas fa-address-book text-4xl text-emerald-400 mb-2 group-hover:scale-110 transition-all"></i>
                <p className="font-black text-slate-300 uppercase text-xs">Agenda VCF</p>
              </div>
            </div>
            <button onClick={() => setIsImportOpen(false)} className="w-full mt-8 py-4 font-black text-slate-500 uppercase text-xs">Cerrar</button>
          </div>
        </div>
      )}

      {editContact && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => setEditContact(null)}></div>
          <form onSubmit={saveEdit} className="relative bg-slate-800 border border-slate-700 p-8 rounded-[3rem] w-full max-w-md shadow-2xl">
            <h2 className="text-3xl font-black mb-8 uppercase tracking-widest">Editar</h2>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Nombre / Usuario</label>
                <input required type="text" value={editContact.name} onChange={e => setEditContact({...editContact, name: e.target.value})} className="w-full bg-slate-900 border border-slate-700 p-4 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Teléfono (Solo números)</label>
                <input type="text" value={editContact.phone} onChange={e => setEditContact({...editContact, phone: e.target.value.replace(/\D/g,'')})} className="w-full bg-slate-900 border border-slate-700 p-4 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={() => setEditContact(null)} className="flex-1 font-black text-slate-500 uppercase text-xs">Cancelar</button>
              <button type="submit" className="flex-1 bg-blue-600 py-4 rounded-2xl font-black uppercase text-xs">Guardar</button>
            </div>
          </form>
        </div>
      )}

      {/* Botón flotante Tinder - Solo Mobile */}
      {contacts.length > 0 && viewMode !== 'tinder' && (
        <button onClick={() => setViewMode('tinder')} className="md:hidden fixed bottom-10 right-10 w-20 h-20 bg-rose-600 rounded-full flex items-center justify-center text-white shadow-2xl z-40 border-8 border-slate-900 active:scale-90 transition-all">
          <i className="fas fa-fire text-3xl"></i>
        </button>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
