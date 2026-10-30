/* EquiCrewWeb mockup behaviour: phone menu and the contact form states.
   The product posts to POST /api/contact; here the send is simulated so the states can be clicked through.
   All text from fields or the server is inserted with textContent, never innerHTML. */
document.documentElement.classList.add("js");

(function initNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.getElementById("site-nav");
  if (!toggle || !nav) return;
  const set = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  };
  toggle.addEventListener("click", () => set(toggle.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      set(false);
      toggle.focus();
    }
  });
})();

(function initContactForm() {
  const form = document.querySelector("form[data-contact-form]");
  if (!form) return;

  const rules = {
    first_name: (v) => (!v.trim() ? "Bitte gib deinen Vornamen ein." : v.length > 100 ? "Der Vorname darf höchstens 100 Zeichen lang sein." : ""),
    last_name: (v) => (!v.trim() ? "Bitte gib deinen Nachnamen ein." : v.length > 100 ? "Der Nachname darf höchstens 100 Zeichen lang sein." : ""),
    email: (v) => (!v.trim() ? "Bitte gib deine Email-Adresse ein." : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? "Bitte gib eine gültige Email-Adresse ein." : ""),
    message: (v) => (!v.trim() ? "Bitte schreib uns eine Nachricht." : v.length > 5000 ? "Die Nachricht darf höchstens 5000 Zeichen lang sein." : ""),
  };
  const fields = Object.keys(rules).map((name) => form.elements[name]);
  const touched = new Set();
  const button = form.querySelector("[data-submit]");
  const alertBox = document.querySelector("[data-form-alert]");
  const success = document.querySelector("[data-form-success]");
  const label = button.querySelector("[data-submit-label]");
  const icon = button.querySelector("[data-submit-icon]");

  function showFieldError(input, message) {
    const slot = document.getElementById(input.name + "-error");
    slot.textContent = "";
    if (message) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "icon");
      svg.setAttribute("data-icon", "lucide/circle-alert");
      svg.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = message;
      slot.append(svg, text);
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
  }
  function validate(input) {
    const message = rules[input.name](input.value);
    showFieldError(input, message);
    return !message;
  }
  fields.forEach((input) => {
    input.addEventListener("input", () => {
      touched.add(input.name);
      if (input.hasAttribute("aria-invalid")) validate(input);
    });
    input.addEventListener("blur", () => {
      if (touched.has(input.name)) validate(input);
    });
  });

  function showAlert(kind) {
    const copy = {
      server: ["Das hat leider nicht geklappt.", "Bitte versuche es in ein paar Minuten noch einmal. Deine Eingaben bleiben erhalten."],
      unavailable: ["Das Formular ist gerade nicht erreichbar.", "Schreib uns bitte direkt an "],
      limited: ["Zu viele Anfragen.", "Bitte warte ein paar Minuten und versuche es dann noch einmal."],
    }[kind];
    const body = alertBox.querySelector("[data-alert-body]");
    body.textContent = "";
    const strong = document.createElement("strong");
    strong.textContent = copy[0];
    body.append(strong, document.createTextNode(copy[1]));
    if (kind === "unavailable") {
      const a = document.createElement("a");
      a.href = "mailto:office@equicrew.com";
      a.textContent = "office@equicrew.com";
      body.append(a, document.createTextNode("."));
    }
    alertBox.hidden = false;
  }

  function setSending(on) {
    button.disabled = on;
    button.setAttribute("aria-busy", String(on));
    label.textContent = on ? "Wird gesendet …" : "Senden";
    icon.setAttribute("data-icon", on ? "lucide/loader" : "lucide/send");
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    fields.forEach((f) => touched.add(f.name));
    const results = fields.map(validate);
    if (results.includes(false)) {
      fields[results.indexOf(false)].focus();
      return;
    }
    if (form.elements.website && form.elements.website.value) return;
    setSending(true);
    // The product awaits fetch(`${apiBase}/api/contact`) here and maps 429 / 503 / other errors to showAlert().
    window.setTimeout(() => {
      setSending(false);
      form.reset();
      touched.clear();
      form.hidden = true;
      success.hidden = false;
    }, 900);
  });
})();
