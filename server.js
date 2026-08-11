const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "database.json");

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({users:[], spins:[]}, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function nextId(items) {
  return items.length ? Math.max(...items.map(x=>x.id))+1 : 1;
}

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "neon-spin-demo-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {httpOnly:true, sameSite:"lax"}
}));
app.use(express.static(path.join(__dirname,"public")));

function auth(req,res,next) {
  if (!req.session.userId) return res.status(401).json({error:"Belum login."});
  next();
}

app.post("/api/register", async (req,res)=>{
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");
  if(!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({error:"Username 3-20 karakter: huruf, angka, underscore."});
  if(password.length<6)
    return res.status(400).json({error:"Password minimal 6 karakter."});
  const db=loadDB();
  if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))
    return res.status(409).json({error:"Username sudah digunakan."});
  const password_hash=await bcrypt.hash(password,12);
  const user={id:nextId(db.users),username,password_hash,virtual_coins:10000,created_at:new Date().toISOString()};
  db.users.push(user); saveDB(db);
  req.session.userId=user.id;
  res.json({ok:true});
});

app.post("/api/login", async (req,res)=>{
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");
  const db=loadDB();
  const user=db.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if(!user || !(await bcrypt.compare(password,user.password_hash)))
    return res.status(401).json({error:"Username atau password salah."});
  req.session.userId=user.id;
  res.json({ok:true});
});

app.post("/api/logout",(req,res)=>{
  req.session.destroy(()=>res.json({ok:true}));
});

app.get("/api/me",auth,(req,res)=>{
  const db=loadDB();
  const u=db.users.find(x=>x.id===req.session.userId);
  if(!u)return res.status(401).json({error:"User tidak ditemukan."});
  res.json({id:u.id,username:u.username,virtual_coins:u.virtual_coins,created_at:u.created_at});
});

app.get("/api/history",auth,(req,res)=>{
  const db=loadDB();
  res.json(db.spins.filter(s=>s.user_id===req.session.userId).slice(-20).reverse());
});

const symbols=["🍒","🔔","7️⃣","💎","BAR","⭐"];
const multipliers={"💎":25,"7️⃣":20,"🔔":12,"🍒":8,"BAR":5,"⭐":3};

app.post("/api/spin",auth,(req,res)=>{
  const bet=Math.floor(Number(req.body.bet));
  if(!Number.isFinite(bet)||bet<10||bet>100000)
    return res.status(400).json({error:"Bet harus antara 10 dan 100.000 koin virtual."});
  const db=loadDB();
  const user=db.users.find(u=>u.id===req.session.userId);
  if(!user)return res.status(401).json({error:"User tidak ditemukan."});
  if(bet>user.virtual_coins)return res.status(400).json({error:"Saldo virtual tidak cukup."});

  const reels=Array.from({length:9},()=>symbols[Math.floor(Math.random()*symbols.length)]);
  const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8]];
  let payout=0,matched=[];
  for(const line of lines){
    const [a,b,c]=line;
    if(reels[a]===reels[b]&&reels[b]===reels[c]){
      const p=bet*(multipliers[reels[a]]||3);
      if(p>payout){payout=p;matched=line;}
    }
  }
  user.virtual_coins=user.virtual_coins-bet+payout;
  db.spins.push({
    id:nextId(db.spins),user_id:user.id,result:JSON.stringify(reels),
    bet_virtual:bet,payout_virtual:payout,created_at:new Date().toISOString()
  });
  if(db.spins.length>1000)db.spins=db.spins.slice(-1000);
  saveDB(db);
  res.json({reels,payout,balance:user.virtual_coins,matched});
});

app.listen(PORT,"0.0.0.0",()=>console.log(`Neon Spin berjalan di http://127.0.0.1:${PORT}`));
