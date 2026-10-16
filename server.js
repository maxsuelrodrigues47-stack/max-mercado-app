const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!process.env.DATABASE_URL || !JWT_SECRET) {
  console.error("Configure DATABASE_URL e JWT_SECRET antes de iniciar.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const money = (n) => Number(n);
const clean = (s, max=200) => String(s ?? "").trim().slice(0, max);
const asyncRoute = (fn) => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      whatsapp TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      email TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(store_id,email)
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Outros',
      price NUMERIC(10,2) NOT NULL CHECK(price >= 0), image_url TEXT NOT NULL DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0), active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '', payment_method TEXT NOT NULL,
      items JSONB NOT NULL, total NUMERIC(10,2) NOT NULL CHECK(total >= 0),
      status TEXT NOT NULL DEFAULT 'Novo', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS products_store_idx ON products(store_id, active);
    CREATE INDEX IF NOT EXISTS orders_store_idx ON orders(store_id, created_at DESC);
  `);
  const slug = slugify(process.env.DEFAULT_STORE_SLUG || "max-mercado");
  let result = await pool.query("SELECT id FROM stores WHERE slug=$1", [slug]);
  let storeId;
  if (!result.rowCount) {
    const s = await pool.query("INSERT INTO stores(name,slug,whatsapp) VALUES($1,$2,$3) RETURNING id", [
      clean(process.env.DEFAULT_STORE_NAME || "Max Mercado",100), slug,
      clean(process.env.DEFAULT_STORE_WHATSAPP || "",30).replace(/\D/g,"")
    ]);
    storeId = s.rows[0].id;
  } else storeId = result.rows[0].id;
  const email = clean(process.env.DEFAULT_ADMIN_EMAIL || "admin@maxmercado.local",180).toLowerCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.warn("DEFAULT_ADMIN_PASSWORD não definida ou curta. Configure uma senha com pelo menos 12 caracteres.");
  } else {
    const found = await pool.query("SELECT id FROM admins WHERE store_id=$1 AND email=$2", [storeId,email]);
    if (!found.rowCount) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query("INSERT INTO admins(store_id,email,password_hash) VALUES($1,$2,$3)", [storeId,email,hash]);
    }
  }
  const count = await pool.query("SELECT COUNT(*)::int AS n FROM products WHERE store_id=$1", [storeId]);
  if (count.rows[0].n === 0) {
    const demo = [
      ["Arroz tipo 1 5kg","Pacote de arroz tipo 1","Mercearia",24.99,"https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=600&q=80",40],
      ["Feijão carioca 1kg","Feijão carioca","Mercearia",7.49,"https://images.unsplash.com/photo-1515543904379-3d7579598962?auto=format&fit=crop&w=600&q=80",30],
      ["Leite integral 1L","Leite integral","Laticínios",4.89,"https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=600&q=80",50],
      ["Óleo de soja 900ml","Óleo de soja","Mercearia",6.99,"https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=600&q=80",25],
      ["Banana prata 1kg","Banana prata fresca","Hortifruti",5.99,"https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=600&q=80",20],
      ["Ovos brancos 12 un.","Dúzia de ovos","Frios e ovos",10.99,"https://images.unsplash.com/photo-1506976785307-8732e854ad03?auto=format&fit=crop&w=600&q=80",18]
    ];
    for (const p of demo) await pool.query(
      "INSERT INTO products(store_id,name,description,category,price,image_url,stock) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [storeId,...p]);
  }
}

function signToken(admin) {
  return jwt.sign({ adminId: admin.id, storeId: admin.store_id, email: admin.email }, JWT_SECRET, { expiresIn: "8h" });
}
function requireAdmin(req,res,next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  try { req.admin = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "Faça login novamente." }); }
}
function requirePlatform(req,res,next) {
  const expected = process.env.PLATFORM_ADMIN_KEY;
  if (!expected || req.headers["x-platform-key"] !== expected) return res.status(401).json({error:"Acesso não autorizado."});
  next();
}
async function getStore(slug) {
  const r = await pool.query("SELECT id,name,slug,whatsapp FROM stores WHERE slug=$1 AND active=TRUE", [slugify(slug)]);
  return r.rows[0] || null;
}
app.get("/api/health", (req,res)=>res.json({ok:true}));
app.get("/api/store", asyncRoute(async (req,res)=>{
  const slug = req.query.store || process.env.DEFAULT_STORE_SLUG || "max-mercado";
  const store = await getStore(slug);
  if (!store) return res.status(404).json({error:"Mercado não encontrado."});
  res.json({store});
}));
app.get("/api/products", asyncRoute(async (req,res)=>{
  const slug = req.query.store || process.env.DEFAULT_STORE_SLUG || "max-mercado";
  const store = await getStore(slug);
  if (!store) return res.status(404).json({error:"Mercado não encontrado."});
  const r = await pool.query("SELECT id,name,description,category,price,image_url,stock FROM products WHERE store_id=$1 AND active=TRUE ORDER BY category,name", [store.id]);
  res.json({products:r.rows});
}));
app.post("/api/orders", asyncRoute(async (req,res)=>{
  const body = req.body || {};
  const store = await getStore(body.store || process.env.DEFAULT_STORE_SLUG || "max-mercado");
  if (!store) return res.status(404).json({error:"Mercado não encontrado."});
  const customerName=clean(body.customerName,120), phone=clean(body.phone,40), address=clean(body.address,500), notes=clean(body.notes,500), payment=clean(body.paymentMethod,50);
  if (!customerName || !phone || !address || !payment || !Array.isArray(body.items) || body.items.length===0) return res.status(400).json({error:"Preencha seus dados e adicione produtos ao carrinho."});
  if (body.items.length > 80) return res.status(400).json({error:"Muitos itens no pedido."});
  const ids = body.items.map(x=>Number(x.id)).filter(Number.isInteger);
  const found = await pool.query("SELECT id,name,price,stock FROM products WHERE store_id=$1 AND active=TRUE AND id=ANY($2::int[])", [store.id,ids]);
  const map = new Map(found.rows.map(p=>[p.id,p]));
  const items=[];
  let total=0;
  for (const raw of body.items) {
    const id=Number(raw.id), qty=Math.max(1,Math.min(99,Math.floor(Number(raw.quantity)||1))), p=map.get(id);
    if (!p) return res.status(400).json({error:"Um produto do carrinho não está mais disponível."});
    if (p.stock < qty) return res.status(400).json({error:`Estoque insuficiente para ${p.name}.`});
    const price=Number(p.price); total += price*qty; items.push({id:p.id,name:p.name,price,quantity:qty});
  }
  total=Math.round(total*100)/100;
  const result = await pool.query("INSERT INTO orders(store_id,customer_name,phone,address,notes,payment_method,items,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at", [store.id,customerName,phone,address,notes,payment,JSON.stringify(items),total]);
  res.status(201).json({order:{id:result.rows[0].id,createdAt:result.rows[0].created_at,total,items},store:{name:store.name,whatsapp:store.whatsapp}});
}));
app.post("/api/admin/login", asyncRoute(async (req,res)=>{
  const email=clean(req.body?.email,180).toLowerCase(), password=String(req.body?.password||"");
  const slug=slugify(req.body?.store || process.env.DEFAULT_STORE_SLUG || "max-mercado");
  const store=await getStore(slug);
  if (!store) return res.status(401).json({error:"E-mail ou senha incorretos."});
  const r=await pool.query("SELECT id,store_id,email,password_hash FROM admins WHERE store_id=$1 AND email=$2", [store.id,email]);
  if (!r.rowCount || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({error:"E-mail ou senha incorretos."});
  res.json({token:signToken(r.rows[0]),store:{name:store.name,slug:store.slug}});
}));
app.get("/api/admin/me", requireAdmin, asyncRoute(async (req,res)=>{
  const r=await pool.query("SELECT id,name,slug,whatsapp FROM stores WHERE id=$1 AND active=TRUE", [req.admin.storeId]);
  if (!r.rowCount) return res.status(401).json({error:"Mercado indisponível."});
  res.json({store:r.rows[0],email:req.admin.email});
}));
app.get("/api/admin/products", requireAdmin, asyncRoute(async (req,res)=>{
  const r=await pool.query("SELECT * FROM products WHERE store_id=$1 ORDER BY created_at DESC", [req.admin.storeId]);
  res.json({products:r.rows});
}));
app.post("/api/admin/products", requireAdmin, asyncRoute(async (req,res)=>{
  const p=req.body||{}, name=clean(p.name,160), category=clean(p.category||"Outros",80);
  const price=money(p.price), stock=Math.floor(Number(p.stock)||0);
  if (!name || !Number.isFinite(price) || price<0 || stock<0) return res.status(400).json({error:"Informe nome, preço válido e estoque igual ou maior que zero."});
  const r=await pool.query("INSERT INTO products(store_id,name,description,category,price,image_url,stock,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [req.admin.storeId,name,clean(p.description,500),category,price,clean(p.imageUrl,1000),stock,p.active!==false]);
  res.status(201).json({product:r.rows[0]});
}));
app.put("/api/admin/products/:id", requireAdmin, asyncRoute(async (req,res)=>{
  const p=req.body||{}, price=money(p.price), stock=Math.floor(Number(p.stock)||0), name=clean(p.name,160);
  if (!name || !Number.isFinite(price) || price<0 || stock<0) return res.status(400).json({error:"Nome, preço ou estoque inválido."});
  const r=await pool.query("UPDATE products SET name=$1,description=$2,category=$3,price=$4,image_url=$5,stock=$6,active=$7,updated_at=NOW() WHERE id=$8 AND store_id=$9 RETURNING *",
    [name,clean(p.description,500),clean(p.category||"Outros",80),price,clean(p.imageUrl,1000),stock,p.active!==false,Number(req.params.id),req.admin.storeId]);
  if (!r.rowCount) return res.status(404).json({error:"Produto não encontrado."});
  res.json({product:r.rows[0]});
}));
app.delete("/api/admin/products/:id", requireAdmin, asyncRoute(async (req,res)=>{
  const r=await pool.query("DELETE FROM products WHERE id=$1 AND store_id=$2 RETURNING id", [Number(req.params.id),req.admin.storeId]);
  if (!r.rowCount) return res.status(404).json({error:"Produto não encontrado."});
  res.json({ok:true});
}));
app.get("/api/admin/orders", requireAdmin, asyncRoute(async (req,res)=>{
  const r=await pool.query("SELECT id,customer_name,phone,address,notes,payment_method,items,total,status,created_at FROM orders WHERE store_id=$1 ORDER BY created_at DESC LIMIT 200", [req.admin.storeId]);
  res.json({orders:r.rows});
}));
app.patch("/api/admin/orders/:id", requireAdmin, asyncRoute(async (req,res)=>{
  const allowed=["Novo","Confirmado","Em preparo","Saiu para entrega","Concluído","Cancelado"];
  const status=clean(req.body?.status,40);
  if (!allowed.includes(status)) return res.status(400).json({error:"Status inválido."});
  const r=await pool.query("UPDATE orders SET status=$1 WHERE id=$2 AND store_id=$3 RETURNING id,status", [status,Number(req.params.id),req.admin.storeId]);
  if (!r.rowCount) return res.status(404).json({error:"Pedido não encontrado."});
  res.json({order:r.rows[0]});
}));
app.put("/api/admin/store", requireAdmin, asyncRoute(async (req,res)=>{
  const name=clean(req.body?.name,100), whatsapp=clean(req.body?.whatsapp,30).replace(/\D/g,"");
  if (!name || whatsapp.length<10) return res.status(400).json({error:"Informe nome e WhatsApp com DDD."});
  const r=await pool.query("UPDATE stores SET name=$1,whatsapp=$2 WHERE id=$3 RETURNING id,name,slug,whatsapp", [name,whatsapp,req.admin.storeId]);
  res.json({store:r.rows[0]});
}));
app.post("/api/platform/stores", requirePlatform, asyncRoute(async (req,res)=>{
  const b=req.body||{}, name=clean(b.name,100), slug=slugify(b.slug||b.name), whatsapp=clean(b.whatsapp,30).replace(/\D/g,""), email=clean(b.adminEmail,180).toLowerCase(), password=String(b.adminPassword||"");
  if (!name || slug.length<2 || whatsapp.length<10 || !email.includes("@") || password.length<12) return res.status(400).json({error:"Informe nome, slug, WhatsApp, e-mail e senha com 12+ caracteres."});
  const hash=await bcrypt.hash(password,12);
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const s=await client.query("INSERT INTO stores(name,slug,whatsapp) VALUES($1,$2,$3) RETURNING id,name,slug", [name,slug,whatsapp]);
    await client.query("INSERT INTO admins(store_id,email,password_hash) VALUES($1,$2,$3)", [s.rows[0].id,email,hash]);
    await client.query("COMMIT");
    res.status(201).json({store:s.rows[0],shopUrl:`/s/${slug}`,adminUrl:`/admin?store=${slug}`});
  } catch(e) { await client.query("ROLLBACK"); if(e.code==="23505") return res.status(409).json({error:"Este slug já está em uso."}); throw e; }
  finally { client.release(); }
}));
app.get("/s/:slug", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/admin", (req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next)=>{
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({error:"Erro interno. Tente novamente mais tarde."});
});
initDb().then(()=>app.listen(PORT,()=>console.log(`Max Mercado rodando na porta ${PORT}`))).catch(e=>{console.error("Falha ao iniciar banco:",e);process.exit(1);});
