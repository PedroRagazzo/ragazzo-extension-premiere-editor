/* Alterna entre o tema "escuro" (padrão) e "papel". A escolha persiste em
 * localStorage e é reaplicada antes do primeiro paint por um script inline
 * no <head> (evita flash do tema errado). Este arquivo só cuida da UI do
 * trocador — quem lê o tema salvo na carga é o script inline.
 */
(function () {
  "use strict";
  var KEY = "ragazzo.theme";
  var root = document.documentElement;
  var buttons = document.querySelectorAll(".theme-swatch");

  function apply(theme) {
    if (theme === "papel") root.setAttribute("data-theme", "papel");
    else root.removeAttribute("data-theme");

    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-choice") === theme));
    }

    // outros módulos (ex.: o canvas do editor de curvas, que lê cores via
    // getComputedStyle e não reage sozinho a mudança de CSS) escutam isto
    // pra se redesenhar com a paleta nova.
    window.dispatchEvent(new CustomEvent("ragazzo-theme-changed", { detail: { theme: theme } }));
  }

  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", function () {
      var theme = this.getAttribute("data-theme-choice");
      try { localStorage.setItem(KEY, theme); } catch (e) {}
      apply(theme);
    });
  }

  apply(root.getAttribute("data-theme") === "papel" ? "papel" : "escuro");
})();
