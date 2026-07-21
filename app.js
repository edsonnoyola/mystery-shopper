import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://kmbyezowarksulzauewp.supabase.co";
const SUPABASE_KEY = "sb_publishable_Q3g-mC_WRnzyMLzQg6dubQ_Wu1djthb";
// sesión persistente: se entra UNA vez y queda guardada en el teléfono
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const $ = (id) => document.getElementById(id);
const views = ["authView", "homeView", "visitaView", "misView", "adminView"];
function show(view) {
  views.forEach((v) => $(v).classList.toggle("hidden", v !== view));
  window.scrollTo(0, 0);
}
const ICO = (n) => `<svg class="ico"><use href="#i-${n}"/></svg>`;
const vibrar = (p) => { try { navigator.vibrate?.(p); } catch { /* opcional */ } };

let usuario = null;
let esAdmin = false;
let subiendo = false;

window.addEventListener("beforeunload", (e) => { if (subiendo) e.preventDefault(); });

// ---------- AUTH ----------
async function initAuth() {
  // 1) sesión guardada en el teléfono
  let { data } = await sb.auth.getSession();
  // 2) si el token venció mientras la app estuvo cerrada, refrescarlo en vez de pedir login
  if (!data.session) {
    const ref = await sb.auth.refreshSession().catch(() => null);
    if (ref?.data?.session) data = ref.data;
  }
  if (data.session) { usuario = data.session.user; await entrar(); }
  else show("authView");
  // si el token se refresca o muere en caliente, mantener el estado correcto
  sb.auth.onAuthStateChange((evento, sesion) => {
    if (evento === "TOKEN_REFRESHED" && sesion) usuario = sesion.user;
    if (evento === "SIGNED_OUT") { usuario = null; show("authView"); }
  });
}

// Enter para entrar (menos fricción en el login)
["authEmail", "authPass"].forEach((id) =>
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnEntrar").click(); })
);

$("btnEntrar").onclick = async () => {
  const email = $("authEmail").value.trim().toLowerCase();
  const password = $("authPass").value;
  if (!email || password.length < 6) { $("authMsg").textContent = "Escribe tu correo y una contraseña de al menos 6 caracteres."; return; }
  $("btnEntrar").classList.add("cargando");
  $("authMsg").textContent = "";
  let { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const alta = await sb.auth.signUp({ email, password, options: { data: { app: "ms" } } });
    if (alta.error) { $("btnEntrar").classList.remove("cargando"); $("authMsg").textContent = "No se pudo entrar: " + alta.error.message; $("authMsg").className = "msg error"; return; }
    if (alta.data.user && Array.isArray(alta.data.user.identities) && alta.data.user.identities.length === 0) {
      $("btnEntrar").classList.remove("cargando");
      $("authMsg").textContent = "Ese correo ya tiene cuenta y la contraseña no coincide. Verifícala o pide al admin restablecerla.";
      $("authMsg").className = "msg error";
      return;
    }
    const reintento = await sb.auth.signInWithPassword({ email, password });
    if (reintento.error) { $("btnEntrar").classList.remove("cargando"); $("authMsg").textContent = "Cuenta creada. Intenta entrar de nuevo."; return; }
    data = reintento.data;
  }
  $("btnEntrar").classList.remove("cargando");
  usuario = data.session.user;
  await entrar();
};

async function entrar() {
  $("btnSalir").classList.remove("hidden");
  const { data } = await sb.from("ms_admins").select("email").limit(1);
  esAdmin = !!(data && data.length);
  $("btnAdmin").classList.toggle("hidden", !esAdmin);
  show("homeView");
  revisarBorrador();
}

// cerrar sesión: discreto y con confirmación para que nadie salga por accidente
$("btnSalir").onclick = async () => {
  if (!confirm("¿Cerrar sesión? Tendrás que volver a escribir tu correo y contraseña.")) return;
  await sb.auth.signOut();
  location.reload();
};

// volver con guarda: no perder trabajo sin querer
document.querySelectorAll(".volver").forEach((b) => (b.onclick = () => {
  const enCaptura = !$("visitaView").classList.contains("hidden");
  const hayTrabajo = capturas.length || $("comentarioVisita").value.trim();
  if (enCaptura && hayTrabajo && !confirm("Tienes capturas sin enviar. Se guardan como borrador, ¿salir?")) return;
  show("homeView");
  revisarBorrador();
}));

// ---------- BORRADOR LOCAL (IndexedDB: nada se pierde) ----------
function abrirDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("ms-db", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("borrador");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
let saveTimer = null;
function guardarBorrador() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const db = await abrirDB();
      const datos = {
        capturas: capturas.map((c) => ({ tipo: c.tipo, blob: c.blob, frameBlob: c.frameBlob || null, comentario: c.comentario })),
        comentario: $("comentarioVisita").value,
        evaluacion, cotizaciones, geo, lugar, tiendaSel,
        tiendaManual: $("tiendaManual").value,
        ts: Date.now(),
      };
      db.transaction("borrador", "readwrite").objectStore("borrador").put(datos, "actual");
    } catch { /* mejor la app que el borrador */ }
  }, 400);
}
async function leerBorrador() {
  try {
    const db = await abrirDB();
    return await new Promise((res) => {
      const r = db.transaction("borrador").objectStore("borrador").get("actual");
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}
async function borrarBorrador() {
  clearTimeout(saveTimer);
  try {
    const db = await abrirDB();
    db.transaction("borrador", "readwrite").objectStore("borrador").delete("actual");
  } catch { /* nada */ }
}
async function revisarBorrador() {
  const b = await leerBorrador();
  const hay = b && ((b.capturas && b.capturas.length) || (b.comentario && b.comentario.trim()));
  $("borradorCard").classList.toggle("hidden", !hay);
  if (!hay) return;
  $("btnBorradorSeguir").onclick = () => {
    prepararCaptura(false);
    capturas = (b.capturas || []).map((c) => ({ ...c, url: URL.createObjectURL(c.blob) }));
    $("comentarioVisita").value = b.comentario || "";
    evaluacion = b.evaluacion || {}; cotizaciones = b.cotizaciones || [];
    geo = b.geo; lugar = b.lugar; tiendaSel = b.tiendaSel;
    $("tiendaManual").value = b.tiendaManual || "";
    if ($("tiendaManual").value) $("tiendaManual").classList.remove("hidden");
    pintarCapturas(); pintarCotizaciones(); pintarLugar(); actualizarEnviar();
    show("visitaView");
    if (!geo) detectarUbicacion();
  };
  $("btnBorradorTirar").onclick = async () => { await borrarBorrador(); $("borradorCard").classList.add("hidden"); };
}

// ---------- CAPTURA ----------
let geo = null;
let lugar = null;
let tiendas = [];
let tiendaSel = null;
let capturas = [];       // [{tipo:'foto'|'video', blob, frameBlob?, url, comentario}]
let evaluacion = {};
let cotizaciones = [];

function prepararCaptura(conGps = true) {
  geo = lugar = tiendaSel = null; tiendas = []; capturas = []; evaluacion = {}; cotizaciones = [];
  $("fotosLista").innerHTML = ""; $("comentarioVisita").value = ""; $("envioMsg").textContent = ""; $("envioMsg").className = "msg"; $("fotoMsg").textContent = "";
  $("tiendaChips").classList.add("hidden"); $("tiendaChips").innerHTML = "";
  $("tiendaManual").classList.add("hidden"); $("tiendaManual").value = "";
  $("btnGpsReintentar").classList.add("hidden");
  $("lugarLinea").innerHTML = `${ICO("pin")} <span class="pulso">Detectando el lugar…</span>`;
  $("lugarMeta").textContent = "";
  $("barra").classList.add("hidden"); $("barraFill").style.width = "0";
  document.querySelectorAll(".stars button.sel, .sino button.sel").forEach((b) => b.classList.remove("sel"));
  document.querySelectorAll("details.card").forEach((d) => (d.open = false));
  pintarCotizaciones();
  actualizarEnviar();
  show("visitaView");
  if (conGps) detectarUbicacion();
}

// los tiles de home son <label> hacia los inputs: la cámara abre en el MISMO gesto;
// aquí solo preparamos la vista (sin preventDefault)
$("tileFoto").addEventListener("click", () => prepararCaptura());
$("tileVideo").addEventListener("click", () => prepararCaptura());
$("btnNota").onclick = () => prepararCaptura();

// ---------- UBICACIÓN ----------
const MONEDAS = {
  MX: "MXN", US: "USD", CO: "COP", AR: "ARS", CL: "CLP", PE: "PEN", BR: "BRL",
  GT: "GTQ", CR: "CRC", PA: "USD", EC: "USD", SV: "USD", HN: "HNL", NI: "NIO",
  DO: "DOP", BO: "BOB", PY: "PYG", UY: "UYU", VE: "VES", CU: "CUP", PR: "USD",
  ES: "EUR", DE: "EUR", FR: "EUR", IT: "EUR", PT: "EUR", NL: "EUR", BE: "EUR",
  GB: "GBP", CA: "CAD", JP: "JPY", CN: "CNY", KR: "KRW", IN: "INR", AU: "AUD",
};

function detectarUbicacion() {
  $("btnGpsReintentar").classList.add("hidden");
  if (!navigator.geolocation) { errorGps("Este teléfono no tiene GPS disponible."); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy };
    await Promise.allSettled([reverseGeocode(), buscarTiendas()]);
    pintarLugar();
    guardarBorrador();
  }, (err) => {
    if (err.code === 1) errorGps("Sin permiso de ubicación — actívalo en los ajustes del navegador.");
    else errorGps("No hay señal de GPS aquí adentro.");
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

function errorGps(msj) {
  $("lugarLinea").innerHTML = `${ICO("pin")} ${msj}`;
  $("lugarMeta").textContent = "Escribe el nombre del lugar abajo.";
  $("btnGpsReintentar").classList.remove("hidden");
  $("tiendaManual").classList.remove("hidden");
}
$("btnGpsReintentar").onclick = (e) => { e.stopPropagation(); detectarUbicacion(); };

async function reverseGeocode() {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${geo.lat}&lon=${geo.lng}&accept-language=es`);
    const j = await r.json();
    const a = j.address || {};
    const cc = (a.country_code || "").toUpperCase();
    lugar = {
      direccion: [a.road, a.house_number, a.suburb || a.neighbourhood].filter(Boolean).join(" "),
      ciudad: a.city || a.town || a.village || a.municipality || "",
      pais: a.country || "", pais_codigo: cc,
      moneda: MONEDAS[cc] || "",
    };
  } catch { /* sin internet: seguimos */ }
}

const FORMATOS = { supermarket: "supermercado", convenience: "conveniencia", kiosk: "changarro", general: "changarro", grocery: "changarro", greengrocer: "changarro", coffee: "cafeteria", cafe: "cafeteria", department_store: "supermercado", marketplace: "changarro" };

async function buscarTiendas() {
  try {
    const q = `[out:json][timeout:10];(
      nwr(around:400,${geo.lat},${geo.lng})[shop~"^(supermarket|convenience|kiosk|general|grocery|greengrocer|coffee|department_store)$"];
      nwr(around:400,${geo.lat},${geo.lng})[amenity~"^(cafe|marketplace)$"];
    );out center 25;`;
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q) });
    const j = await r.json();
    tiendas = (j.elements || [])
      .map((e) => {
        const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
        const t = e.tags || {};
        return {
          osm_id: String(e.type) + "/" + e.id,
          nombre: t.name || t.brand || "(sin nombre)",
          formato: FORMATOS[t.shop] || FORMATOS[t.amenity] || "otro",
          lat, lng, dist: distM(geo.lat, geo.lng, lat, lng),
        };
      })
      .filter((t) => t.nombre !== "(sin nombre)")
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 8);
  } catch { /* Overpass caído */ }
}

function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function pintarLugar() {
  const ubic = [lugar?.ciudad, lugar?.pais].filter(Boolean).join(", ");
  const mon = lugar?.moneda ? ` · ${lugar.moneda}` : "";
  // si el segundo candidato está igual de cerca que la precisión del GPS, mejor preguntar
  const ambiguo = tiendas.length > 1 && (tiendas[1].dist - tiendas[0].dist) < Math.max(geo?.precision || 30, 30);
  if (!tiendaSel) tiendaSel = tiendas[0] || null;

  if (tiendaSel && !ambiguo) {
    $("lugarLinea").innerHTML = `${ICO("pin")} ${tiendaSel.nombre} <span class="muted">›</span>`;
    $("lugarMeta").textContent = `${tiendaSel.formato} · ${tiendaSel.dist} m${ubic ? " · " + ubic : ""}${mon}`;
  } else if (ambiguo) {
    $("lugarLinea").innerHTML = `${ICO("pin")} ¿En cuál de estos lugares estás?`;
    $("lugarMeta").textContent = `${ubic}${mon}`;
    abrirChipsTiendas();
  } else {
    $("lugarLinea").innerHTML = `${ICO("pin")} ${ubic || "Ubicación detectada"}`;
    $("lugarMeta").textContent = `${mon ? "Precios en " + lugar.moneda + " · " : ""}toca para elegir o escribir el lugar`;
  }
}

function abrirChipsTiendas() {
  const chips = $("tiendaChips");
  chips.innerHTML = "";
  tiendas.forEach((t) => {
    const b = document.createElement("button"); b.type = "button";
    b.className = "chip" + (tiendaSel && t.osm_id === tiendaSel.osm_id ? " sel" : "");
    b.innerHTML = `${t.nombre} <span class="fmt">${t.formato} · ${t.dist} m</span>`;
    b.onclick = (e) => {
      e.stopPropagation();
      tiendaSel = t; $("tiendaManual").value = "";
      chips.classList.add("hidden"); $("tiendaManual").classList.add("hidden");
      pintarLugar(); guardarBorrador();
    };
    chips.appendChild(b);
  });
  chips.classList.remove("hidden");
  $("tiendaManual").classList.remove("hidden");
}

$("lugarCard").onclick = (e) => {
  if (e.target.closest(".chip") || e.target.id === "tiendaManual" || e.target.id === "btnGpsReintentar") return;
  if (!$("tiendaChips").classList.contains("hidden")) return;
  if (tiendas.length) abrirChipsTiendas();
  else $("tiendaManual").classList.remove("hidden");
};
$("tiendaManual").oninput = () => { if ($("tiendaManual").value.trim()) tiendaSel = null; guardarBorrador(); };

// ---------- FOTO / VIDEO / GALERÍA ----------
$("inputFoto").onchange = (ev) => procesarArchivos(ev, "foto");
$("inputVideo").onchange = (ev) => procesarArchivos(ev, "video");
$("inputGaleria").onchange = (ev) => procesarArchivos(ev, null);

async function procesarArchivos(ev, tipoFijo) {
  const files = [...ev.target.files];
  ev.target.value = "";
  if (!files.length) return;
  // si llega desde home, la vista ya se preparó en el click del label
  if ($("visitaView").classList.contains("hidden")) prepararCaptura();
  for (const file of files) {
    const tipo = tipoFijo || (file.type.startsWith("video") ? "video" : "foto");
    $("fotoMsg").textContent = "Procesando…";
    try {
      if (tipo === "foto") {
        let blob;
        try { blob = await comprimir(file); } catch { blob = file; }
        capturas.push({ tipo, blob, url: URL.createObjectURL(blob), comentario: "" });
      } else {
        const frameBlob = await extraerFrame(file).catch(() => null);
        capturas.push({ tipo, blob: file, frameBlob, url: URL.createObjectURL(file), comentario: "" });
      }
      vibrar(20);
    } catch (e) {
      console.error(e);
      $("fotoMsg").textContent = "No se pudo procesar ese archivo.";
      continue;
    }
  }
  $("fotoMsg").textContent = "";
  pintarCapturas(true);
  guardarBorrador();
}

async function comprimir(file, maxLado = 1600, calidad = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return file;
    const esc = Math.min(1, maxLado / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * esc); c.height = Math.round(h * esc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", calidad));
    return blob || file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extraerFrame(file) {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "metadata";
    v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      const esc = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * esc); c.height = Math.round(v.videoHeight * esc);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => { URL.revokeObjectURL(v.src); b ? res(b) : rej(new Error("sin frame")); }, "image/jpeg", 0.8);
    };
    v.onerror = () => rej(new Error("video no legible"));
  });
}

function pintarCapturas(scrollAlFinal = false) {
  const g = $("fotosLista"); g.innerHTML = "";
  capturas.forEach((f, i) => {
    const d = document.createElement("div"); d.className = "foto-card";

    const head = document.createElement("div"); head.className = "encabezado";
    const num = document.createElement("span"); num.className = "numero";
    num.innerHTML = `${ICO(f.tipo === "video" ? "video" : "camara")} ${f.tipo === "video" ? "Video" : "Foto"} ${i + 1}`;
    const del = document.createElement("button"); del.className = "del"; del.textContent = "Quitar"; del.type = "button";
    del.onclick = () => {
      if (!confirm("¿Quitar esta captura?")) return;
      URL.revokeObjectURL(f.url); capturas.splice(i, 1); pintarCapturas(); guardarBorrador();
    };
    head.append(num, del);
    d.appendChild(head);

    if (f.tipo === "video") {
      const v = document.createElement("video");
      v.src = f.url; v.controls = true; v.playsInline = true; v.muted = true;
      d.appendChild(v);
    } else {
      const img = document.createElement("img"); img.src = f.url; img.alt = `Foto ${i + 1}`;
      d.appendChild(img);
    }

    const ta = document.createElement("textarea");
    ta.placeholder = "¿Qué es? (escribe o dicta) — ej. 'frasco nuevo de la competencia'";
    ta.value = f.comentario;
    ta.oninput = () => { f.comentario = ta.value; guardarBorrador(); };
    d.appendChild(ta);

    const mic = document.createElement("button"); mic.type = "button"; mic.className = "secondary small";
    mic.innerHTML = `${ICO("mic")} Dictar`;
    mic.onclick = () => dictar(ta, mic, (t) => { f.comentario = t; guardarBorrador(); });
    d.appendChild(mic);

    g.appendChild(d);
  });
  actualizarEnviar();
  if (scrollAlFinal && g.lastElementChild) g.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- DICTADO ----------
let recActivo = null;
function dictar(textarea, boton, onTexto) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $("envioMsg").textContent = "Usa el micrófono del teclado de tu celular para dictar."; textarea.focus(); return; }
  if (recActivo) { recActivo.stop(); return; }
  const rec = new SR();
  rec.lang = "es-MX"; rec.continuous = true; rec.interimResults = true;
  const base = textarea.value ? textarea.value.trim() + " " : "";
  const original = boton.innerHTML;
  boton.classList.add("mic-activo"); boton.textContent = "Detener";
  rec.onresult = (e) => {
    let txt = "";
    for (const r of e.results) txt += r[0].transcript;
    textarea.value = base + txt;
    onTexto(textarea.value);
  };
  const fin = () => { boton.classList.remove("mic-activo"); boton.innerHTML = original; recActivo = null; };
  rec.onend = fin; rec.onerror = fin;
  rec.start(); recActivo = rec;
}
$("btnMicNota").onclick = () => dictar($("comentarioVisita"), $("btnMicNota"), () => guardarBorrador());
$("comentarioVisita").addEventListener("input", () => { actualizarEnviar(); guardarBorrador(); });

function actualizarEnviar() {
  const n = capturas.length;
  const hayNota = !!$("comentarioVisita").value.trim();
  $("btnEnviar").disabled = n === 0 && !hayNota;
  $("btnEnviarTxt").textContent = n > 0 ? `Enviar (${n})` : hayNota ? "Enviar nota" : "Enviar";
  $("envioMsg").textContent = (n === 0 && !hayNota) ? "Agrega una foto, un video o una nota para enviar." : $("envioMsg").classList.contains("error") ? $("envioMsg").textContent : "";
}

// ---------- EVALUACIÓN OPCIONAL ----------
document.querySelectorAll(".eval-fila .stars").forEach((cont) => {
  const campo = cont.closest(".eval-fila").dataset.campo;
  for (let v = 1; v <= 5; v++) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = v;
    b.onclick = () => {
      evaluacion[campo] = v;
      [...cont.children].forEach((c, i) => c.classList.toggle("sel", i < v));
      guardarBorrador();
    };
    cont.appendChild(b);
  }
});
document.querySelectorAll(".sino button").forEach((b) => {
  b.onclick = () => {
    evaluacion.marca_mencionada = b.dataset.v === "si";
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
    guardarBorrador();
  };
});

$("btnAgregarCotiza").onclick = () => {
  const c = {
    marca: $("cotMarca").value.trim(),
    producto: $("cotProducto").value.trim(),
    formato: $("cotFormato").value.trim(),
    precio: parseFloat($("cotPrecio").value),
  };
  if (!c.marca && !c.producto) return;
  if (isNaN(c.precio)) { $("envioMsg").textContent = "Ponle precio a la cotización."; return; }
  cotizaciones.push(c);
  ["cotMarca", "cotProducto", "cotFormato", "cotPrecio"].forEach((id) => ($(id).value = ""));
  $("envioMsg").textContent = "";
  pintarCotizaciones();
  guardarBorrador();
};

function pintarCotizaciones() {
  const g = $("cotizaLista"); g.innerHTML = "";
  cotizaciones.forEach((c, i) => {
    const d = document.createElement("div"); d.className = "cotiza-item";
    d.innerHTML = `<span>${c.marca} ${c.producto} <span class="muted">${c.formato || ""}</span></span><b>$${c.precio}</b>`;
    const del = document.createElement("button"); del.className = "del-cot"; del.textContent = "✕"; del.type = "button";
    del.onclick = () => { cotizaciones.splice(i, 1); pintarCotizaciones(); guardarBorrador(); };
    d.appendChild(del); g.appendChild(d);
  });
}

// ---------- ENVIAR ----------
function progreso(pct) {
  $("barra").classList.remove("hidden");
  $("barraFill").style.width = Math.round(pct) + "%";
}

$("btnEnviar").onclick = async () => {
  if (recActivo) recActivo.stop();
  if (!navigator.onLine) {
    $("envioMsg").textContent = "Sin conexión — tu captura está guardada localmente. Reintenta al salir de la tienda.";
    $("envioMsg").className = "msg error";
    return;
  }
  subiendo = true;
  $("btnEnviar").classList.add("cargando");
  $("envioMsg").textContent = ""; $("envioMsg").className = "msg";
  const pasos = 2 + capturas.length;
  let paso = 0;
  const avanza = () => progreso((++paso / pasos) * 100);
  try {
    // 1. lugar
    let tienda_id = null;
    const nombreManual = $("tiendaManual").value.trim();
    if (tiendaSel) {
      const { data: prev } = await sb.from("ms_tiendas").select("id").eq("osm_id", tiendaSel.osm_id).maybeSingle();
      if (prev) tienda_id = prev.id;
      else {
        const { data: nueva, error } = await sb.from("ms_tiendas").insert({
          nombre: tiendaSel.nombre, formato: tiendaSel.formato, osm_id: tiendaSel.osm_id,
          lat: tiendaSel.lat, lng: tiendaSel.lng,
          direccion: lugar?.direccion, ciudad: lugar?.ciudad, pais: lugar?.pais, pais_codigo: lugar?.pais_codigo,
        }).select("id").single();
        if (error) throw error;
        tienda_id = nueva.id;
      }
    } else if (nombreManual) {
      const { data: nueva, error } = await sb.from("ms_tiendas").insert({
        nombre: nombreManual, formato: "otro", lat: geo?.lat, lng: geo?.lng,
        direccion: lugar?.direccion, ciudad: lugar?.ciudad, pais: lugar?.pais, pais_codigo: lugar?.pais_codigo,
      }).select("id").single();
      if (error) throw error;
      tienda_id = nueva.id;
    }
    avanza();

    // 2. visita
    const tipo = capturas.length === 0 ? "nota" : (tiendaSel?.formato === "cafeteria" ? "experiencia" : "anaquel");
    const { data: visita, error: ev } = await sb.from("ms_visitas").insert({
      tienda_id, tipo, shopper_email: usuario.email,
      lat: geo?.lat, lng: geo?.lng, precision_m: geo?.precision,
      pais: lugar?.pais, direccion: lugar?.direccion,
      comentario: $("comentarioVisita").value.trim() || null,
      evaluacion: Object.keys(evaluacion).length ? evaluacion : null,
      categoria: "cafe",
      moneda: lugar?.moneda || null,
    }).select("id").single();
    if (ev) throw ev;
    avanza();

    if (cotizaciones.length) {
      await sb.from("ms_cotizaciones").insert(cotizaciones.map((c) => ({
        visita_id: visita.id, marca: c.marca || null, producto: c.producto || null,
        formato: c.formato || null, precio: c.precio, moneda: lugar?.moneda || "MXN",
      })));
    }

    // 3. capturas
    const fotoIds = [];
    for (let i = 0; i < capturas.length; i++) {
      const f = capturas[i];
      $("envioMsg").textContent = `Subiendo ${i + 1} de ${capturas.length}…`;
      let storage_path, video_path = null;
      if (f.tipo === "video") {
        video_path = `${visita.id}/${i + 1}.mp4`;
        const { error: ev2 } = await sb.storage.from("ms-fotos").upload(video_path, f.blob, { contentType: f.blob.type || "video/mp4" });
        if (ev2) throw ev2;
        if (f.frameBlob) {
          storage_path = `${visita.id}/${i + 1}-frame.jpg`;
          const { error: ef2 } = await sb.storage.from("ms-fotos").upload(storage_path, f.frameBlob, { contentType: "image/jpeg" });
          if (ef2) throw ef2;
        } else {
          storage_path = video_path;
        }
      } else {
        storage_path = `${visita.id}/${i + 1}.jpg`;
        const tiposOk = ["image/jpeg", "image/png", "image/webp"];
        const ct = tiposOk.includes(f.blob.type) ? f.blob.type : "image/jpeg";
        const { error: es } = await sb.storage.from("ms-fotos").upload(storage_path, f.blob, { contentType: ct });
        if (es) throw es;
      }
      const { data: foto, error: efila } = await sb.from("ms_fotos").insert({
        visita_id: visita.id, storage_path, video_path, comentario: f.comentario || null,
        lat: geo?.lat, lng: geo?.lng,
      }).select("id").single();
      if (efila) throw efila;
      if (f.tipo !== "video" || f.frameBlob) fotoIds.push(foto.id);
      avanza();
    }

    // 4. IA
    if (fotoIds.length) fotoIds.forEach((id) => sb.functions.invoke("ms-analizar-foto", { body: { foto_id: id } }).catch(() => {}));
    else sb.functions.invoke("ms-analizar-foto", { body: { visita_id: visita.id } }).catch(() => {});

    await borrarBorrador();
    $("borradorCard").classList.add("hidden");
    subiendo = false;
    $("btnEnviar").classList.remove("cargando");
    vibrar([50, 50, 50]);
    $("exitoOverlay").classList.remove("hidden");
    setTimeout(() => { $("exitoOverlay").classList.add("hidden"); show("homeView"); revisarBorrador(); }, 1700);
  } catch (e) {
    console.error(e);
    subiendo = false;
    $("btnEnviar").classList.remove("cargando");
    $("envioMsg").textContent = "Error al enviar: " + (e.message || e) + " — tu captura sigue guardada, toca Reintentar.";
    $("envioMsg").className = "msg error";
    $("btnEnviarTxt").textContent = "Reintentar";
  }
};

// ---------- MIS CAPTURAS ----------
const SKELETON = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';

$("btnMis").onclick = async () => {
  show("misView");
  $("misLista").innerHTML = SKELETON;
  const { data: visitas } = await sb.from("ms_visitas")
    .select("id, created_at, tipo, estado, score, resumen_ia, productos, evaluacion, comentario, pais, ms_tiendas(nombre, formato), ms_cotizaciones(marca, producto, formato, precio, moneda)")
    .eq("shopper_id", usuario.id).order("created_at", { ascending: false }).limit(30);
  $("misLista").innerHTML = "";
  if (!visitas?.length) {
    $("misLista").innerHTML = '<div class="card"><p class="muted" style="margin:0">Aún no tienes capturas. Toca Foto en el inicio y haz la primera.</p></div>';
    return;
  }
  for (const v of visitas) $("misLista").appendChild(await tarjetaVisita(v));
};

function claseScore(s) { return s == null ? "na" : s >= 8 ? "ok" : s >= 6 ? "mid" : "bad"; }

function evaluacionHtml(ev) {
  if (!ev) return "";
  const rubros = [["saludo", "Saludo"], ["conocimiento", "Conocimiento"], ["claridad_precios", "Precios"], ["limpieza", "Limpieza"]];
  const partes = rubros.filter(([k]) => ev[k] != null).map(([k, n]) => `${n} ${ev[k]}/5`);
  if (ev.marca_mencionada != null) partes.push(ev.marca_mencionada ? "Nos recomendaron" : "NO nos recomendaron");
  return partes.length ? `<p class="muted" style="font-size:var(--text-xs); margin:0.3rem 0">${partes.join(" · ")}</p>` : "";
}

function cotizacionesHtml(cots) {
  if (!Array.isArray(cots) || !cots.length) return "";
  const filas = cots.map((c) =>
    `<div class="prod"><span>${[c.marca, c.producto].filter(Boolean).join(" ")}</span><span class="muted">${c.formato || ""}</span><b>$${c.precio} ${c.moneda || ""}</b></div>`
  ).join("");
  return `<div class="prods">${filas}</div>`;
}

function productosHtml(prods) {
  if (!Array.isArray(prods) || !prods.length) return "";
  const filas = prods.map((p) => {
    const nombre = [p.marca, p.linea_o_variedad || p.sabor_o_variedad].filter(Boolean).join(" ") || "(producto)";
    const formato = [p.formato || p.presentacion, p.gramaje].filter(Boolean).join(" ");
    const precio = p.precio ? `${p.precio} ${p.moneda || ""}${p.unidad || ""}` : "s/precio";
    const enlace = p.origen_precio === "enlazado-otra-foto" ? " ⛓" : "";
    return `<div class="prod"><span>${nombre}${p.tostado ? ` <span class="muted">· ${p.tostado}</span>` : ""}</span><span class="muted">${formato}</span><b>${precio}${enlace}</b></div>`;
  }).join("");
  return `<div class="prods">${filas}</div>`;
}

async function tarjetaVisita(v, adminExtra = "") {
  const d = document.createElement("div"); d.className = "card visita-item";
  const fecha = new Date(v.created_at).toLocaleDateString("es", { day: "numeric", month: "short" });
  d.innerHTML = `<div class="head">
      <span class="nombre">${v.ms_tiendas?.nombre || (v.tipo === "nota" ? "Nota" : "Lugar")} <span class="muted">· ${v.ms_tiendas?.formato || v.tipo}</span></span>
      <span class="score ${claseScore(v.score)}">${v.score != null ? Number(v.score).toFixed(1) : "…"}</span>
    </div>
    <p class="muted">${fecha} · ${v.pais || ""} ${adminExtra}</p>
    ${v.comentario ? `<p class="txt-sm">${v.comentario}</p>` : ""}
    ${v.resumen_ia ? `<p class="txt-sm">${v.resumen_ia}</p>` : `<p class="muted ${v.estado === "analizada" ? "" : "procesando"}">${v.estado === "analizada" ? "" : "Análisis en proceso…"}</p>`}
    ${evaluacionHtml(v.evaluacion)}
    ${cotizacionesHtml(v.ms_cotizaciones)}
    ${productosHtml(v.productos)}
    <div class="thumbs"></div>`;
  const { data: fs } = await sb.from("ms_fotos").select("id, storage_path, video_path, analisis").eq("visita_id", v.id);
  if (fs?.length) {
    const { data: sus } = await sb.storage.from("ms-fotos").createSignedUrls(fs.map((f) => f.storage_path), 3600);
    const cont = d.querySelector(".thumbs");
    (sus || []).forEach((su, i) => {
      if (!su?.signedUrl) return;
      const f = fs[i];
      const img = document.createElement("img"); img.src = su.signedUrl; img.alt = "captura";
      img.onclick = () => abrirModal(f, su.signedUrl);
      cont.appendChild(img);
    });
  }
  return d;
}

// modal con el análisis legible (no JSON crudo)
async function abrirModal(f, urlImg) {
  $("modalImg").src = urlImg;
  const a = f.analisis;
  let html = "";
  if (f.video_path && f.video_path !== f.storage_path) {
    const { data: sv } = await sb.storage.from("ms-fotos").createSignedUrl(f.video_path, 3600);
    if (sv) html += `<p><a href="${sv.signedUrl}" target="_blank" style="color:var(--accent)">Ver video completo</a></p>`;
  }
  if (!a) {
    html += '<p class="muted procesando">Análisis en proceso…</p>';
  } else {
    if (a.resumen) html += `<p><b>${a.resumen}</b></p>`;
    if (a.score != null) html += `<p class="muted">Calificación: <span class="score ${claseScore(a.score)}">${a.score}</span></p>`;
    if (Array.isArray(a.etiquetas) && a.etiquetas.length) html += `<div class="chips">${a.etiquetas.map((e) => `<span class="etq">${e}</span>`).join("")}</div>`;
    if (Array.isArray(a.productos) && a.productos.length) {
      html += `<div class="prods">${a.productos.map((p) => {
        const nombre = [p.marca, p.linea_o_variedad].filter(Boolean).join(" ") || "(producto)";
        return `<div class="prod"><span>${nombre}</span><span class="muted">${p.formato || ""}</span><b>${p.precio_visible || p.precio || "s/precio"} ${p.moneda || ""}</b></div>`;
      }).join("")}</div>`;
    }
    if (Array.isArray(a.hallazgos) && a.hallazgos.length) {
      html += a.hallazgos.map((h) => `<p class="txt-sm">• ${h.descripcion} <span class="muted">(${h.severidad})</span></p>`).join("");
    }
    html += `<details><summary class="muted">Detalle técnico</summary><pre>${JSON.stringify(a, null, 2)}</pre></details>`;
  }
  $("modalAnalisis").innerHTML = html;
  $("modalFoto").classList.remove("hidden");
}
$("modalCerrar").onclick = () => $("modalFoto").classList.add("hidden");
$("modalFoto").onclick = (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden"); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("modalFoto").classList.add("hidden"); });

// ---------- ADMIN ----------
$("btnAdmin").onclick = async () => {
  show("adminView");
  $("adminLista").innerHTML = SKELETON;

  const [{ data: visitas }, { data: fotosAll }, { data: productos }, { data: precios }] = await Promise.all([
    sb.from("ms_visitas").select("id, created_at, tipo, estado, score, resumen_ia, productos, evaluacion, comentario, pais, shopper_email, ms_tiendas(nombre, formato), ms_cotizaciones(marca, producto, formato, precio, moneda)").order("created_at", { ascending: false }).limit(40),
    sb.from("ms_fotos").select("etiquetas").not("etiquetas", "eq", "{}").limit(1000),
    sb.from("ms_productos").select("id, marca, linea, formato, veces_visto").order("veces_visto", { ascending: false }).limit(40),
    sb.from("ms_precios").select("producto_id, precio, moneda, pais").limit(2000),
  ]);

  const total = visitas?.length || 0;
  const conScore = (visitas || []).filter((v) => v.score != null);
  const prom = conScore.length ? (conScore.reduce((a, v) => a + Number(v.score), 0) / conScore.length).toFixed(1) : "—";
  const paises = [...new Set((visitas || []).map((v) => v.pais).filter(Boolean))];
  $("adminResumen").innerHTML = `<p style="margin:0"><b>${total}</b> capturas recientes · score promedio <b>${prom}</b></p>
    <p class="muted" style="margin:0.2rem 0 0">Países: ${paises.join(", ") || "—"}</p>`;

  const conteo = {};
  (fotosAll || []).forEach((f) => (f.etiquetas || []).forEach((e) => (conteo[e] = (conteo[e] || 0) + 1)));
  const top = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 15);
  $("adminEtiquetas").innerHTML = top.length
    ? top.map(([e, n]) => `<span class="etq">${e} <b>×${n}</b></span>`).join("")
    : "<p class='muted'>Aún no hay fotos analizadas.</p>";

  const porProducto = {};
  (precios || []).forEach((p) => { (porProducto[p.producto_id] ||= []).push(p); });
  $("adminProductos").innerHTML = (productos || []).length
    ? (productos || []).map((p) => {
        const ps = porProducto[p.id] || [];
        const nums = ps.map((x) => Number(x.precio)).filter((n) => !isNaN(n));
        const moneda = ps[0]?.moneda || "";
        const rango = nums.length
          ? (Math.min(...nums) === Math.max(...nums)
            ? `$${Math.min(...nums)} ${moneda}`
            : `$${Math.min(...nums)}–$${Math.max(...nums)} ${moneda}`)
          : "s/precio";
        const paisesP = [...new Set(ps.map((x) => x.pais).filter(Boolean))].join(", ");
        return `<div class="prod"><span>${[p.marca, p.linea].filter(Boolean).join(" ")} <span class="muted">${p.formato || ""}</span></span><span class="muted">visto ×${p.veces_visto}${paisesP ? " · " + paisesP : ""}</span><b>${rango}</b></div>`;
      }).join("")
    : "<p class='muted'>Se llenará solo conforme los shoppers capturen productos.</p>";

  $("adminLista").innerHTML = "";
  for (const v of visitas || []) $("adminLista").appendChild(await tarjetaVisita(v, `· ${v.shopper_email || ""}`));
};

// ---------- PWA ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

initAuth();
