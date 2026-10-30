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

  // Al abrir un <details> del TOC en móvil no hace falta nada más; el resto es HTML puro.
})();
