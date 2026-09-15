const toast = document.querySelector(".toast");

function showToast(message){
  if(!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(()=>toast.classList.remove("show"), 2200);
}

// Mobile navigation: the desktop navigation is hidden on small screens,
// so build a real full-screen drawer from the same links instead of relying
// on the tiny hamburger glyph alone.
(function initMobileMenu(){
  const header = document.querySelector(".site-header");
  const nav = document.querySelector(".nav");
  const trigger = document.querySelector(".menu-btn");
  if(!header || !nav || !trigger) return;

  const style = document.createElement("style");
  style.textContent = `
    @media (max-width:760px){
      body.menu-open{overflow:hidden}
      .mobile-menu{position:fixed;inset:72px 0 0;z-index:100;display:none}
      .mobile-menu.open{display:block}
      .mobile-menu-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(8px)}
      .mobile-menu-panel{position:absolute;left:0;right:0;top:0;padding:8px 18px 20px;background:linear-gradient(180deg,rgba(10,11,11,.99),rgba(5,6,6,.98));border-bottom:1px solid rgba(216,180,106,.35);box-shadow:0 25px 80px rgba(0,0,0,.8)}
      .mobile-menu-head{display:flex;align-items:center;justify-content:space-between;padding:14px 4px 12px;border-bottom:1px solid rgba(255,255,255,.08)}
      .mobile-menu-kicker{display:block;color:var(--gold);font:700 9px var(--font-head);letter-spacing:3px;margin-bottom:3px}
      .mobile-menu-head strong{font:800 25px var(--font-head);letter-spacing:1px}
      .mobile-menu-close{width:42px;height:42px;border:1px solid rgba(216,180,106,.35);background:#0c0d0d;color:var(--text);font:400 28px var(--font-body);cursor:pointer}
      .mobile-menu-links{padding-top:7px}
      .mobile-menu-links a{display:flex;align-items:center;min-height:51px;padding:0 12px;color:#aaa;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.06);font:700 16px var(--font-head);letter-spacing:1.3px;text-transform:uppercase}
      .mobile-menu-links a:hover,.mobile-menu-links a:active{color:var(--text);background:linear-gradient(90deg,rgba(216,180,106,.12),transparent)}
      .mobile-menu-footer{padding:14px 12px 2px;color:#666;font:600 8px var(--font-head);letter-spacing:3px}
      .menu-btn{position:relative;z-index:110;display:block;width:44px;height:44px;padding:0;border:1px solid rgba(216,180,106,.25);background:rgba(5,6,6,.45);color:var(--text);font-size:28px;line-height:1}
    }
  `;
  document.head.appendChild(style);

  const drawer = document.createElement("div");
  drawer.className = "mobile-menu";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="mobile-menu-backdrop" data-menu-close></div>
    <aside class="mobile-menu-panel" aria-label="Menu mobile">
      <div class="mobile-menu-head">
        <div>
          <span class="mobile-menu-kicker">FOOTVAULT</span>
          <strong>MENU</strong>
        </div>
        <button class="mobile-menu-close" type="button" aria-label="Fermer le menu">×</button>
      </div>
      <div class="mobile-menu-links"></div>
      <div class="mobile-menu-footer">COLLECT THE GAME.</div>
    </aside>`;
  document.body.appendChild(drawer);

  const links = drawer.querySelector(".mobile-menu-links");
  nav.querySelectorAll("a").forEach(link=>{
    const clone = link.cloneNode(true);
    clone.classList.remove("active");
    links.appendChild(clone);
  });

  const close = ()=>{
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("menu-open");
    trigger.setAttribute("aria-expanded", "false");
  };
  const open = ()=>{
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("menu-open");
    trigger.setAttribute("aria-expanded", "true");
  };

  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", ()=>drawer.classList.contains("open") ? close() : open());
  drawer.querySelector(".mobile-menu-close").addEventListener("click", close);
  drawer.querySelector("[data-menu-close]").addEventListener("click", close);
  links.querySelectorAll("a").forEach(link=>link.addEventListener("click", close));
  document.addEventListener("keydown", e=>{ if(e.key === "Escape") close(); });
  window.addEventListener("resize", ()=>{ if(window.innerWidth > 760) close(); });
})();

document.querySelectorAll("[data-scroll]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const target = document.querySelector(btn.dataset.scroll);
    if(target) target.scrollIntoView({behavior:"smooth"});
  });
});

document.querySelectorAll("[data-pack]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const target=document.querySelector("#packs");
    if(target) target.scrollIntoView({behavior:"smooth"});
  });
});

document.querySelectorAll(".collection-card").forEach(card=>{
  card.addEventListener("click", ()=>{
    const href=card.dataset.href;
    if(href){location.href=href;return;}
    showToast(`${card.dataset.collection} — album bientôt disponible.`);
  });
});

const tilt = document.querySelector(".tilt-card");
if(tilt && window.matchMedia("(pointer:fine)").matches){
  tilt.addEventListener("mousemove", e=>{
    const r = tilt.getBoundingClientRect();
    const x = (e.clientX-r.left)/r.width-.5;
    const y = (e.clientY-r.top)/r.height-.5;
    tilt.style.transform = `rotate(${x*5+2}deg) rotateX(${-y*4}deg) rotateY(${x*5}deg) translateY(-4px)`;
  });
  tilt.addEventListener("mouseleave", ()=>{
    tilt.style.transform = "rotate(7deg)";
  });
}

document.querySelector(".icon-btn")?.addEventListener("click", ()=>showToast("Recherche — bientôt disponible."));
