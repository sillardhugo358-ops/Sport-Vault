const toast = document.querySelector(".toast");

function showToast(message){
  if(!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(()=>toast.classList.remove("show"), 2200);
}

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
