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
