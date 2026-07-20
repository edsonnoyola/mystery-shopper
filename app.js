import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://kmbyezowarksulzauewp.supabase.co";
const SUPABASE_KEY = "sb_publishable_Q3g-mC_WRnzyMLzQg6dubQ_Wu1djthb";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const views = ["authView", "homeView", "visitaView", "misView", "adminView"];
function show(view) {
  views.forEach((v) => $(v).classList.toggle("hidden", v !== view));
  window.scrollTo(0, 0);
}

let usuario = null;
let esAdmin = false;

// ---------- AUTH ----------
async function initAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) { usuario = data.session.user; await entrar(); }
  else show("authView");
}

$("btnEntrar").onclick = async () => {
  const email = $("authEmail").value.trim().toLowerCase();
  const password = $("authPass").value;
  if (!email || password.length < 6) { $("authMsg").textContent = "Escribe tu correo y una contraseña de al menos 6 caracteres."; return; }
  $("authMsg").textContent = "Entrando…";
  let { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    // primera vez: crear cuenta sola (se auto-confirma) y entrar de inmediato
    const alta = await sb.auth.signUp({ email, password, options: { data: { app: "ms" } } });
    if (alta.error) { $("authMsg").textContent = "No se pudo entrar: " + alta.error.message; return; }
    if (alta.data.user && Array.isArray(alta.data.user.identities) && alta.data.user.identities.length === 0) {
      $("authMsg").textContent = "Ese correo ya tiene cuenta y la contraseña no coincide. Verifícala o pide al admin restablecerla.";
      return;
    }
    const reintento = await sb.auth.signInWithPassword({ email, password });
    if (reintento.error) { $("authMsg").textContent = "Cuenta creada. Intenta entrar de nuevo."; return; }
    data = reintento.data;
  }
  usuario = data.session.user;
  await entrar();
};

async function entrar() {
  $("btnSalir").classList.remove("hidden");
  const { data } = await sb.from("ms_admins").select("email").limit(1);
  esAdmin = !!(data && data.length);
  $("btnAdmin").classList.toggle("hidden", !esAdmin);
  show("homeView");
}

$("btnSalir").onclick = async () => { await sb.auth.signOut(); location.reload(); };
document.querySelectorAll(".volver").forEach((b) => (b.onclick = () => show("homeView")));

// ---------- CAPTURA ----------
let geo = null;          // {lat, lng, precision}
let lugar = null;        // reverse geocode {direccion, ciudad, pais, pais_codigo}
let tiendas = [];        // candidatas OSM
let tiendaSel = null;    // seleccionada
let capturas = [];       // [{tipo:'foto'|'video', blob, frameBlob?, url, comentario}]
let evaluacion = {};
let cotizaciones = [];

function iniciarCaptura(abrir) {
  geo = lugar = tiendaSel = null; tiendas = []; capturas = []; evaluacion = {}; cotizaciones = [];
  $("fotosLista").innerHTML = ""; $("comentarioVisita").value = ""; $("envioMsg").textContent = ""; $("fotoMsg").textContent = "";
  $("tiendaChips").classList.add("hidden"); $("tiendaChips").innerHTML = "";
  $("tiendaManual").classList.add("hidden"); $("tiendaManual").value = "";
  $("lugarLinea").textContent = "📍 Detectando el lugar…";
  document.querySelectorAll(".stars button.sel, .sino button.sel").forEach((b) => b.classList.remove("sel"));
  document.querySelectorAll("details.card").forEach((d) => (d.open = false));
  pintarCotizaciones();
  actualizarEnviar();
  show("visitaView");
  detectarUbicacion();
  // abre la cámara de inmediato, sin pasos intermedios
  if (abrir === "foto") setTimeout(() => $("inputFoto").click(), 150);
  if (abrir === "video") setTimeout(() => $("inputVideo").click(), 150);
}

$("btnNueva").onclick = () => iniciarCaptura("foto");
$("btnVideo").onclick = () => iniciarCaptura("video");
$("btnNota").onclick = () => iniciarCaptura(null);

// ---------- UBICACIÓN AUTOMÁTICA ----------
function detectarUbicacion() {
  if (!navigator.geolocation) { $("lugarLinea").textContent = "📍 Sin GPS — toca aquí para escribir el lugar"; modoManual(); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy };
    await Promise.allSettled([reverseGeocode(), buscarTiendas()]);
    pintarLugar();
  }, () => {
    $("lugarLinea").textContent = "📍 Sin permiso de ubicación — toca para escribir el lugar";
    modoManual();
  }, { enableHighAccuracy: true, timeout: 12000 });
}

async function reverseGeocode() {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${geo.lat}&lon=${geo.lng}&accept-language=es`);
    const j = await r.json();
    const a = j.address || {};
    lugar = {
      direccion: [a.road, a.house_number, a.suburb || a.neighbourhood].filter(Boolean).join(" "),
      ciudad: a.city || a.town || a.village || a.municipality || "",
      pais: a.country || "", pais_codigo: (a.country_code || "").toUpperCase(),
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
  tiendaSel = tiendas[0] || null;
  const ubic = [lugar?.ciudad, lugar?.pais].filter(Boolean).join(", ");
  $("lugarLinea").textContent = tiendaSel
    ? `📍 ${tiendaSel.nombre} · ${tiendaSel.formato} · ${tiendaSel.dist} m ${ubic ? "· " + ubic : ""} (toca para cambiar)`
    : `📍 ${ubic || "Ubicación detectada"} — toca para elegir el lugar`;
}

$("lugarCard").onclick = (e) => {
  if (e.target.closest(".chip") || e.target.id === "tiendaManual") return;
  const chips = $("tiendaChips");
  if (!chips.classList.contains("hidden")) return;
  chips.innerHTML = "";
  tiendas.forEach((t) => {
    const b = document.createElement("button"); b.type = "button";
    b.className = "chip" + (tiendaSel && t.osm_id === tiendaSel.osm_id ? " sel" : "");
    b.innerHTML = `${t.nombre} <span class="fmt">${t.formato} · ${t.dist} m</span>`;
    b.onclick = () => { tiendaSel = t; $("tiendaManual").value = ""; pintarLugar(); chips.classList.add("hidden"); $("tiendaManual").classList.add("hidden"); };
    chips.appendChild(b);
  });
  chips.classList.remove("hidden");
  $("tiendaManual").classList.remove("hidden");
};
function modoManual() { $("tiendaManual").classList.remove("hidden"); }
$("tiendaManual").oninput = () => { if ($("tiendaManual").value.trim()) tiendaSel = null; };

// ---------- FOTO / VIDEO ----------
$("inputFoto").onchange = (ev) => procesarArchivo(ev, "foto");
$("inputVideo").onchange = (ev) => procesarArchivo(ev, "video");

async function procesarArchivo(ev, tipo) {
  const file = ev.target.files[0];
  if (!file) return;
  $("fotoMsg").textContent = "⏳ Procesando…";
  try {
    if (tipo === "foto") {
      let blob;
      try { blob = await comprimir(file); } catch { blob = file; }
      capturas.push({ tipo, blob, url: URL.createObjectURL(blob), comentario: "" });
    } else {
      const frameBlob = await extraerFrame(file).catch(() => null);
      capturas.push({ tipo, blob: file, frameBlob, url: URL.createObjectURL(file), comentario: "" });
    }
    $("fotoMsg").textContent = "";
    pintarCapturas(true);
  } catch (e) {
    console.error(e);
    $("fotoMsg").textContent = "⚠️ No se pudo procesar. Intenta de nuevo.";
  }
  ev.target.value = "";
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

// saca un cuadro del video para que la IA lo analice como imagen
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
    num.textContent = `${f.tipo === "video" ? "🎥 Video" : "📸 Foto"} ${i + 1}`;
    const del = document.createElement("button"); del.className = "del"; del.textContent = "✕ Quitar"; del.type = "button";
    del.onclick = () => { URL.revokeObjectURL(f.url); capturas.splice(i, 1); pintarCapturas(); };
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
    ta.placeholder = "Descríbele a la IA qué es (escribe o dicta) — ej. 'frasco nuevo de la competencia'";
    ta.value = f.comentario;
    ta.oninput = () => (f.comentario = ta.value);
    d.appendChild(ta);

    const mic = document.createElement("button"); mic.type = "button"; mic.className = "secondary small"; mic.textContent = "🎤 Dictar";
    mic.onclick = () => dictar(ta, mic, (t) => (f.comentario = t));
    d.appendChild(mic);

    g.appendChild(d);
  });
  actualizarEnviar();
  if (scrollAlFinal && g.lastElementChild) g.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- DICTADO POR VOZ ----------
let recActivo = null;
function dictar(textarea, boton, onTexto) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $("envioMsg").textContent = "💡 Usa el micrófono 🎤 del teclado de tu celular para dictar."; textarea.focus(); return; }
  if (recActivo) { recActivo.stop(); return; }
  const rec = new SR();
  rec.lang = "es-MX"; rec.continuous = true; rec.interimResults = true;
  const base = textarea.value ? textarea.value.trim() + " " : "";
  boton.classList.add("mic-activo"); boton.textContent = "⏹ Detener";
  rec.onresult = (e) => {
    let txt = "";
    for (const r of e.results) txt += r[0].transcript;
    textarea.value = base + txt;
    onTexto(textarea.value);
  };
  const fin = () => { boton.classList.remove("mic-activo"); boton.textContent = "🎤 Dictar"; recActivo = null; };
  rec.onend = fin; rec.onerror = fin;
  rec.start(); recActivo = rec;
}
$("btnMicNota").onclick = () => dictar($("comentarioVisita"), $("btnMicNota"), () => {});
$("comentarioVisita").addEventListener("input", actualizarEnviar);

function actualizarEnviar() {
  $("btnEnviar").disabled = capturas.length === 0 && !$("comentarioVisita").value.trim();
}

// ---------- EVALUACIÓN OPCIONAL ----------
document.querySelectorAll(".eval-fila .stars").forEach((cont) => {
  const campo = cont.closest(".eval-fila").dataset.campo;
  for (let v = 1; v <= 5; v++) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = v;
    b.onclick = () => {
      evaluacion[campo] = v;
      [...cont.children].forEach((c, i) => c.classList.toggle("sel", i < v));
    };
    cont.appendChild(b);
  }
});
document.querySelectorAll(".sino button").forEach((b) => {
  b.onclick = () => {
    evaluacion.marca_mencionada = b.dataset.v === "si";
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
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
};

function pintarCotizaciones() {
  const g = $("cotizaLista"); g.innerHTML = "";
  cotizaciones.forEach((c, i) => {
    const d = document.createElement("div"); d.className = "cotiza-item";
    d.innerHTML = `<span>${c.marca} ${c.producto} <span class="muted">${c.formato || ""}</span></span><b>$${c.precio}</b>`;
    const del = document.createElement("button"); del.className = "del-cot"; del.textContent = "✕"; del.type = "button";
    del.onclick = () => { cotizaciones.splice(i, 1); pintarCotizaciones(); };
    d.appendChild(del); g.appendChild(d);
  });
}

// ---------- ENVIAR ----------
$("btnEnviar").onclick = async () => {
  if (recActivo) recActivo.stop();
  $("btnEnviar").disabled = true;
  $("envioMsg").textContent = "Enviando…";
  try {
    // 1. lugar: detectado o manual
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

    // 2. visita
    const tipo = capturas.length === 0 ? "nota" : (tiendaSel?.formato === "cafeteria" ? "experiencia" : "anaquel");
    const { data: visita, error: ev } = await sb.from("ms_visitas").insert({
      tienda_id, tipo, shopper_email: usuario.email,
      lat: geo?.lat, lng: geo?.lng, precision_m: geo?.precision,
      pais: lugar?.pais, direccion: lugar?.direccion,
      comentario: $("comentarioVisita").value.trim() || null,
      evaluacion: Object.keys(evaluacion).length ? evaluacion : null,
      categoria: "cafe",
    }).select("id").single();
    if (ev) throw ev;

    if (cotizaciones.length) {
      await sb.from("ms_cotizaciones").insert(cotizaciones.map((c) => ({
        visita_id: visita.id, marca: c.marca || null, producto: c.producto || null,
        formato: c.formato || null, precio: c.precio,
      })));
    }

    // 3. capturas → storage + fila + IA
    const fotoIds = [];
    for (let i = 0; i < capturas.length; i++) {
      const f = capturas[i];
      $("envioMsg").textContent = `Subiendo ${f.tipo} ${i + 1} de ${capturas.length}…`;
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
          storage_path = video_path; // sin frame: no se analiza pero se guarda
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
    }

    // 4. IA: fotos/frames, o solo la nota si no hubo capturas
    if (fotoIds.length) fotoIds.forEach((id) => sb.functions.invoke("ms-analizar-foto", { body: { foto_id: id } }).catch(() => {}));
    else sb.functions.invoke("ms-analizar-foto", { body: { visita_id: visita.id } }).catch(() => {});

    $("envioMsg").textContent = "✅ Enviado. La IA ya está trabajando.";
    setTimeout(() => show("homeView"), 1600);
  } catch (e) {
    console.error(e);
    $("envioMsg").textContent = "⚠️ Error al enviar: " + (e.message || e);
    $("btnEnviar").disabled = false;
  }
};

// ---------- MIS CAPTURAS ----------
$("btnMis").onclick = async () => {
  show("misView");
  $("misLista").innerHTML = "<p class='muted'>Cargando…</p>";
  const { data: visitas } = await sb.from("ms_visitas")
    .select("id, created_at, tipo, estado, score, resumen_ia, productos, evaluacion, comentario, pais, ms_tiendas(nombre, formato), ms_cotizaciones(marca, producto, formato, precio, moneda)")
    .eq("shopper_id", usuario.id).order("created_at", { ascending: false }).limit(30);
  $("misLista").innerHTML = "";
  if (!visitas?.length) { $("misLista").innerHTML = "<p class='muted'>Aún no tienes capturas.</p>"; return; }
  for (const v of visitas) $("misLista").appendChild(await tarjetaVisita(v));
};

function claseScore(s) { return s == null ? "na" : s >= 8 ? "ok" : s >= 6 ? "mid" : "bad"; }

function evaluacionHtml(ev) {
  if (!ev) return "";
  const rubros = [["saludo", "👋"], ["conocimiento", "🧠"], ["claridad_precios", "🏷️"], ["limpieza", "🧹"]];
  const partes = rubros.filter(([k]) => ev[k] != null).map(([k, ico]) => `${ico} ${ev[k]}/5`);
  if (ev.marca_mencionada != null) partes.push(ev.marca_mencionada ? "⭐ nos mencionaron" : "⭐ NO nos mencionaron");
  return partes.length ? `<p style="font-size:0.85rem; margin:0.3rem 0">${partes.join(" · ")}</p>` : "";
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
    const enlace = p.origen_precio === "enlazado-otra-foto" ? " 🔗" : "";
    return `<div class="prod"><span>${nombre}${p.tostado ? ` <span class="muted">· ${p.tostado}</span>` : ""}</span><span class="muted">${formato}</span><b>${precio}${enlace}</b></div>`;
  }).join("");
  return `<div class="prods">${filas}</div>`;
}

async function tarjetaVisita(v, adminExtra = "") {
  const d = document.createElement("div"); d.className = "card visita-item";
  const fecha = new Date(v.created_at).toLocaleDateString("es", { day: "numeric", month: "short" });
  const tipoIco = v.tipo === "nota" ? "📝" : v.tipo === "experiencia" ? "☕" : "🛒";
  d.innerHTML = `<div class="head">
      <span class="nombre">${v.ms_tiendas?.nombre || (v.tipo === "nota" ? "Nota" : "Lugar")} <span class="muted">· ${v.ms_tiendas?.formato || v.tipo}</span></span>
      <span class="score ${claseScore(v.score)}">${v.score != null ? Number(v.score).toFixed(1) : "…"}</span>
    </div>
    <p class="muted">${tipoIco} ${fecha} · ${v.pais || ""} ${adminExtra}</p>
    ${v.comentario ? `<p style="font-size:0.88rem">💬 ${v.comentario}</p>` : ""}
    ${v.resumen_ia ? `<p style="font-size:0.9rem">🤖 ${v.resumen_ia}</p>` : `<p class="muted">${v.estado === "analizada" ? "" : "🤖 Análisis en proceso…"}</p>`}
    ${evaluacionHtml(v.evaluacion)}
    ${cotizacionesHtml(v.ms_cotizaciones)}
    ${productosHtml(v.productos)}
    <div class="thumbs"></div>`;
  const { data: fs } = await sb.from("ms_fotos").select("id, storage_path, video_path, analisis").eq("visita_id", v.id);
  const cont = d.querySelector(".thumbs");
  for (const f of fs || []) {
    const { data: su } = await sb.storage.from("ms-fotos").createSignedUrl(f.storage_path, 3600);
    if (!su) continue;
    const img = document.createElement("img"); img.src = su.signedUrl;
    img.onclick = async () => {
      $("modalImg").src = su.signedUrl;
      let texto = f.analisis ? JSON.stringify(f.analisis, null, 2) : "🤖 Análisis pendiente…";
      if (f.video_path && f.video_path !== f.storage_path) {
        const { data: sv } = await sb.storage.from("ms-fotos").createSignedUrl(f.video_path, 3600);
        if (sv) texto = "🎥 Video: " + sv.signedUrl + "\n\n" + texto;
      }
      $("modalAnalisis").textContent = texto;
      $("modalFoto").classList.remove("hidden");
    };
    cont.appendChild(img);
  }
  return d;
}

// ---------- ADMIN ----------
$("btnAdmin").onclick = async () => {
  show("adminView");
  $("adminLista").innerHTML = "<p class='muted'>Cargando…</p>";

  const [{ data: visitas }, { data: fotosAll }, { data: productos }, { data: precios }] = await Promise.all([
    sb.from("ms_visitas").select("id, created_at, tipo, estado, score, resumen_ia, productos, evaluacion, comentario, pais, shopper_email, ms_tiendas(nombre, formato), ms_cotizaciones(marca, producto, formato, precio, moneda)").order("created_at", { ascending: false }).limit(40),
    sb.from("ms_fotos").select("etiquetas").not("etiquetas", "eq", "{}").limit(1000),
    sb.from("ms_productos").select("id, marca, linea, formato, veces_visto").order("veces_visto", { ascending: false }).limit(40),
    sb.from("ms_precios").select("producto_id, precio, moneda, pais").limit(2000),
  ]);

  // catálogo que se armó solo con las capturas
  const porProducto = {};
  (precios || []).forEach((p) => {
    (porProducto[p.producto_id] ||= []).push(p);
  });
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
        const paises = [...new Set(ps.map((x) => x.pais).filter(Boolean))].join(", ");
        return `<div class="prod"><span>${[p.marca, p.linea].filter(Boolean).join(" ")} <span class="muted">${p.formato || ""}</span></span><span class="muted">visto ×${p.veces_visto}${paises ? " · " + paises : ""}</span><b>${rango}</b></div>`;
      }).join("")
    : "<p class='muted'>Se llenará solo conforme los shoppers capturen productos.</p>";

  const total = visitas?.length || 0;
  const conScore = (visitas || []).filter((v) => v.score != null);
  const prom = conScore.length ? (conScore.reduce((a, v) => a + Number(v.score), 0) / conScore.length).toFixed(1) : "—";
  const paises = [...new Set((visitas || []).map((v) => v.pais).filter(Boolean))];
  $("adminResumen").innerHTML = `<p><b>${total}</b> capturas recientes · score promedio <b>${prom}</b></p>
    <p class="muted">Países: ${paises.join(", ") || "—"}</p>`;

  const conteo = {};
  (fotosAll || []).forEach((f) => (f.etiquetas || []).forEach((e) => (conteo[e] = (conteo[e] || 0) + 1)));
  const top = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 15);
  $("adminEtiquetas").innerHTML = top.length
    ? top.map(([e, n]) => `<span class="etq">${e} <b>×${n}</b></span>`).join("")
    : "<p class='muted'>Aún no hay fotos analizadas.</p>";

  $("adminLista").innerHTML = "";
  for (const v of visitas || []) $("adminLista").appendChild(await tarjetaVisita(v, `· ${v.shopper_email || ""}`));
};

// ---------- PWA ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

initAuth();
