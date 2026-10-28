(function () {
  "use strict";

  // Menú móvil
  var boton = document.querySelector(".menu-boton");
  var menu = document.getElementById("menu-principal");
  if (boton && menu) {
    boton.addEventListener("click", function () {
      var abierto = menu.classList.toggle("abierto");
      boton.setAttribute("aria-expanded", String(abierto));
    });
  }

  // Syllabus: expandir / contraer todo
  document.querySelectorAll("[data-expandir]").forEach(function (b) {
    b.addEventListener("click", function () {
      var abrir = b.getAttribute("data-expandir") === "todo";
      document.querySelectorAll("details.modulo").forEach(function (d) { d.open = abrir; });
    });
  });

  // Botón "Copiar" en bloques de código
  if (navigator.clipboard) {
    document.querySelectorAll(".prosa .highlight").forEach(function (bloque) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "copiar";
      b.textContent = "Copiar";
      b.setAttribute("aria-label", "Copiar código al portapapeles");
      b.addEventListener("click", function () {
        var codigo = bloque.querySelector("code");
        navigator.clipboard.writeText(codigo ? codigo.innerText : "").then(function () {
          b.textContent = "¡Copiado!";
          setTimeout(function () { b.textContent = "Copiar"; }, 1500);
        });
      });
      bloque.appendChild(b);
    });
  }

  // Índice lateral: resalta la sección que se está leyendo
  var enlaces = document.querySelectorAll(".toc--lateral a[href^='#']");
  if (enlaces.length && "IntersectionObserver" in window) {
    var porId = {};
    enlaces.forEach(function (a) { porId[decodeURIComponent(a.getAttribute("href").slice(1))] = a; });
    var visibles = {};
    var marcar = function () {
      var primero = null;
      document.querySelectorAll(".prosa h2[id]").forEach(function (h) {
        if (!primero && visibles[h.id]) primero = h.id;
      });
      if (!primero) return;
      enlaces.forEach(function (a) { a.classList.remove("activo"); });
      if (porId[primero]) porId[primero].classList.add("activo");
    };
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) { visibles[e.target.id] = e.isIntersecting; });
      marcar();
    }, { rootMargin: "-80px 0px -60% 0px" });
    document.querySelectorAll(".prosa h2[id]").forEach(function (h) { obs.observe(h); });
  }
})();
