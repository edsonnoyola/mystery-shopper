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
      // el correo ya tiene cuenta: la contraseña escrita no coincide
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

// ---------- NUEVA VISITA ----------
let geo = null;          // {lat, lng, precision}
let lugar = null;        // reverse geocode {direccion, ciudad, pais, pais_codigo}
let tiendas = [];        // candidatas OSM
let tiendaSel = null;    // seleccionada
let fotos = [];          // [{blob, url, comentario}]

$("btnNueva").onclick = () => {
  geo = lugar = tiendaSel = null; tiendas = []; fotos = [];
  $("fotosLista").innerHTML = ""; $("comentarioVisita").value = ""; $("envioMsg").textContent = ""; $("fotoMsg").textContent = "";
  $("tiendaManual").classList.add("hidden"); $("tiendaManual").value = "";
  $("pasoTienda").classList.add("hidden"); $("pasoFotos").classList.add("hidden");
  $("gpsEstado").textContent = "📍 Detectando tu ubicación…"; $("gpsDireccion").textContent = "";
  $("btnEnviar").disabled = true;
  show("visitaView");
  detectarUbicacion();
};

function detectarUbicacion() {
  if (!navigator.geolocation) { $("gpsEstado").textContent = "⚠️ Tu navegador no tiene GPS. Escribe la tienda a mano."; mostrarPasoTienda(); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy };
    $("gpsEstado").textContent = "📍 Ubicación detectada. Buscando la tienda…";
    await Promise.allSettled([reverseGeocode(), buscarTiendas()]);
    $("gpsEstado").textContent = "📍 Listo";
    $("gpsDireccion").textContent = lugar ? `${lugar.direccion || ""} · ${lugar.pais || ""}` : "";
    mostrarPasoTienda();
  }, () => {
    $("gpsEstado").textContent = "⚠️ Sin permiso de ubicación. Escribe la tienda a mano.";
    mostrarPasoTienda();
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
  } catch { /* sin internet o rate limit: seguimos sin dirección */ }
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
  } catch { /* Overpass caído: fallback manual */ }
}

function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function mostrarPasoTienda() {
  const cont = $("tiendaChips"); cont.innerHTML = "";
  tiendas.forEach((t, i) => {
    const b = document.createElement("button");
    b.className = "chip" + (i === 0 ? " sel" : "");
    b.innerHTML = `${t.nombre} <span class="fmt">${t.formato} · ${t.dist} m</span>`;
    b.onclick = () => { tiendaSel = t; [...cont.children].forEach((c) => c.classList.remove("sel")); b.classList.add("sel"); $("tiendaManual").classList.add("hidden"); };
    cont.appendChild(b);
  });
  if (tiendas.length) tiendaSel = tiendas[0];
  else { $("tiendaManual").classList.remove("hidden"); $("btnTiendaOtra").classList.add("hidden"); }
  $("pasoTienda").classList.remove("hidden");
  $("pasoFotos").classList.remove("hidden");
}

$("btnTiendaOtra").onclick = () => {
  tiendaSel = null;
  [...$("tiendaChips").children].forEach((c) => c.classList.remove("sel"));
  $("tiendaManual").classList.remove("hidden"); $("tiendaManual").focus();
};

// ---------- FOTOS ----------
$("inputFoto").onchange = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  $("fotoMsg").textContent = "⏳ Procesando foto…";
  try {
    const blob = await comprimir(file);
    fotos.push({ blob, url: URL.createObjectURL(blob), comentario: "" });
    $("fotoMsg").textContent = "";
    pintarFotos(true);
  } catch (e) {
    console.error(e);
    // si algo falla, guardamos la foto original tal cual: nunca se pierde
    fotos.push({ blob: file, url: URL.createObjectURL(file), comentario: "" });
    $("fotoMsg").textContent = "";
    pintarFotos(true);
  }
  ev.target.value = "";
};

function pintarFotos(scrollAlFinal = false) {
  const g = $("fotosLista"); g.innerHTML = "";
  fotos.forEach((f, i) => {
    const d = document.createElement("div"); d.className = "foto-card";

    const head = document.createElement("div"); head.className = "encabezado";
    const num = document.createElement("span"); num.className = "numero"; num.textContent = `Foto ${i + 1}`;
    const del = document.createElement("button"); del.className = "del"; del.textContent = "✕ Quitar";
    del.onclick = () => { URL.revokeObjectURL(f.url); fotos.splice(i, 1); pintarFotos(); };
    head.append(num, del);

    const img = document.createElement("img"); img.src = f.url; img.alt = `Foto ${i + 1}`;

    const ta = document.createElement("textarea");
    ta.placeholder = "Descripción de esta foto (ej. 'precio del frasco 200g', 'anaquel vacío')";
    ta.value = f.comentario;
    ta.oninput = () => (f.comentario = ta.value);

    d.append(head, img, ta); g.appendChild(d);
  });
  $("btnEnviar").disabled = fotos.length === 0;
  if (scrollAlFinal && g.lastElementChild) g.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
}

// compresión robusta: usa <img> (respeta orientación EXIF en todos los navegadores);
// si el navegador no puede, regresa el archivo original
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

// ---------- ENVIAR ----------
$("btnEnviar").onclick = async () => {
  $("btnEnviar").disabled = true;
  $("envioMsg").textContent = "Enviando…";
  try {
    // 1. tienda: detectada (upsert por osm_id) o manual
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
    const tipo = (tiendaSel?.formato === "cafeteria") ? "experiencia" : "anaquel";
    const { data: visita, error: ev } = await sb.from("ms_visitas").insert({
      tienda_id, tipo, shopper_email: usuario.email,
      lat: geo?.lat, lng: geo?.lng, precision_m: geo?.precision,
      pais: lugar?.pais, direccion: lugar?.direccion,
      comentario: $("comentarioVisita").value.trim() || null,
    }).select("id").single();
    if (ev) throw ev;

    // 3. fotos → storage + fila + análisis IA
    const fotoIds = [];
    for (let i = 0; i < fotos.length; i++) {
      $("envioMsg").textContent = `Subiendo foto ${i + 1} de ${fotos.length}…`;
      const path = `${visita.id}/${i + 1}.jpg`;
      const tiposOk = ["image/jpeg", "image/png", "image/webp"];
      const ct = tiposOk.includes(fotos[i].blob.type) ? fotos[i].blob.type : "image/jpeg";
      const { error: es } = await sb.storage.from("ms-fotos").upload(path, fotos[i].blob, { contentType: ct });
      if (es) throw es;
      const { data: foto, error: ef } = await sb.from("ms_fotos").insert({
        visita_id: visita.id, storage_path: path, comentario: fotos[i].comentario || null,
        lat: geo?.lat, lng: geo?.lng,
      }).select("id").single();
      if (ef) throw ef;
      fotoIds.push(foto.id);
    }

    // 4. dispara el análisis IA (sin bloquear)
    fotoIds.forEach((id) => sb.functions.invoke("ms-analizar-foto", { body: { foto_id: id } }).catch(() => {}));

    $("envioMsg").textContent = "✅ Visita enviada. La IA ya está analizando tus fotos.";
    setTimeout(() => show("homeView"), 1800);
  } catch (e) {
    console.error(e);
    $("envioMsg").textContent = "⚠️ Error al enviar: " + (e.message || e);
    $("btnEnviar").disabled = false;
  }
};

// ---------- MIS VISITAS ----------
$("btnMis").onclick = async () => {
  show("misView");
  $("misLista").innerHTML = "<p class='muted'>Cargando…</p>";
  const { data: visitas } = await sb.from("ms_visitas")
    .select("id, created_at, tipo, estado, score, resumen_ia, productos, pais, ms_tiendas(nombre, formato)")
    .eq("shopper_id", usuario.id).order("created_at", { ascending: false }).limit(30);
  $("misLista").innerHTML = "";
  if (!visitas?.length) { $("misLista").innerHTML = "<p class='muted'>Aún no tienes visitas.</p>"; return; }
  for (const v of visitas) $("misLista").appendChild(await tarjetaVisita(v));
};

function claseScore(s) { return s == null ? "na" : s >= 8 ? "ok" : s >= 6 ? "mid" : "bad"; }

// productos consolidados por la IA (marca + formato + gramaje + precio enlazado entre fotos)
function productosHtml(prods) {
  if (!Array.isArray(prods) || !prods.length) return "";
  const filas = prods.map((p) => {
    const nombre = [p.marca, p.sabor_o_variedad].filter(Boolean).join(" ") || "(producto)";
    const formato = [p.presentacion, p.gramaje].filter(Boolean).join(" ");
    const precio = p.precio ? `${p.precio} ${p.moneda || ""}` : "s/precio";
    const enlace = p.origen_precio === "enlazado-otra-foto" ? " 🔗" : "";
    return `<div class="prod"><span>${nombre}${p.tostado ? ` <span class="muted">· ${p.tostado}</span>` : ""}</span><span class="muted">${formato}</span><b>${precio}${enlace}</b></div>`;
  }).join("");
  return `<div class="prods">${filas}</div>`;
}

async function tarjetaVisita(v, adminExtra = "") {
  const d = document.createElement("div"); d.className = "card visita-item";
  const fecha = new Date(v.created_at).toLocaleDateString("es", { day: "numeric", month: "short" });
  d.innerHTML = `<div class="head">
      <span class="nombre">${v.ms_tiendas?.nombre || "Tienda"} <span class="muted">· ${v.ms_tiendas?.formato || ""}</span></span>
      <span class="score ${claseScore(v.score)}">${v.score != null ? Number(v.score).toFixed(1) : "…"}</span>
    </div>
    <p class="muted">${fecha} · ${v.tipo} · ${v.pais || ""} ${adminExtra}</p>
    ${v.resumen_ia ? `<p style="font-size:0.9rem">${v.resumen_ia}</p>` : `<p class="muted">${v.estado === "analizada" ? "" : "🤖 Análisis en proceso…"}</p>`}
    ${productosHtml(v.productos)}
    <div class="thumbs"></div>`;
  const { data: fs } = await sb.from("ms_fotos").select("id, storage_path, analisis").eq("visita_id", v.id);
  const cont = d.querySelector(".thumbs");
  for (const f of fs || []) {
    const { data: su } = await sb.storage.from("ms-fotos").createSignedUrl(f.storage_path, 3600);
    if (!su) continue;
    const img = document.createElement("img"); img.src = su.signedUrl;
    img.onclick = () => {
      $("modalImg").src = su.signedUrl;
      $("modalAnalisis").textContent = f.analisis ? JSON.stringify(f.analisis, null, 2) : "🤖 Análisis pendiente…";
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

  const [{ data: visitas }, { data: fotosAll }] = await Promise.all([
    sb.from("ms_visitas").select("id, created_at, tipo, estado, score, resumen_ia, productos, pais, shopper_email, ms_tiendas(nombre, formato)").order("created_at", { ascending: false }).limit(40),
    sb.from("ms_fotos").select("etiquetas").not("etiquetas", "eq", "{}").limit(1000),
  ]);

  const total = visitas?.length || 0;
  const conScore = (visitas || []).filter((v) => v.score != null);
  const prom = conScore.length ? (conScore.reduce((a, v) => a + Number(v.score), 0) / conScore.length).toFixed(1) : "—";
  const paises = [...new Set((visitas || []).map((v) => v.pais).filter(Boolean))];
  $("adminResumen").innerHTML = `<p><b>${total}</b> visitas recientes · score promedio <b>${prom}</b></p>
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
