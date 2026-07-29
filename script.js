// ---------- Revelado sutil al hacer scroll ----------
// Usa IntersectionObserver en vez de listeners de scroll manuales: más barato
// en rendimiento y respeta "prefers-reduced-motion" (definido en styles.css).
const revealEls = document.querySelectorAll('.reveal');

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const delay = el.dataset.delay ? Number(el.dataset.delay) : 0;
      setTimeout(() => el.classList.add('is-visible'), delay);
      observer.unobserve(el);
    }
  });
}, { threshold: 0.15 });

revealEls.forEach((el) => observer.observe(el));


// ---------- Acordeón FAQ ----------
// Los <details> nativos ocultan su contenido de golpe (display:none), así que
// controlamos la apertura/cierre a mano para poder animar max-height/opacity.
const faqItems = document.querySelectorAll('.faq-item');

function openFaqItem(item) {
  const body = item.querySelector('.faq-body');
  item.setAttribute('open', '');
  const target = body.scrollHeight;
  body.style.maxHeight = target + 'px';
  body.style.opacity = '1';

  const onEnd = (e) => {
    if (e.propertyName === 'max-height') {
      body.style.maxHeight = 'none';
      body.removeEventListener('transitionend', onEnd);
    }
  };
  body.addEventListener('transitionend', onEnd);
}

function closeFaqItem(item) {
  const body = item.querySelector('.faq-body');
  const current = body.scrollHeight;
  body.style.maxHeight = current + 'px';

  requestAnimationFrame(() => {
    body.style.maxHeight = '0px';
    body.style.opacity = '0';
  });

  const onEnd = (e) => {
    if (e.propertyName === 'max-height') {
      item.removeAttribute('open');
      body.removeEventListener('transitionend', onEnd);
    }
  };
  body.addEventListener('transitionend', onEnd);
}

faqItems.forEach((item) => {
  const summary = item.querySelector('summary');
  summary.addEventListener('click', (e) => {
    e.preventDefault();
    if (item.hasAttribute('open')) {
      closeFaqItem(item);
    } else {
      faqItems.forEach((other) => {
        if (other !== item && other.hasAttribute('open')) closeFaqItem(other);
      });
      openFaqItem(item);
    }
  });
});


// ---------- Formularios de contacto (hero + sección completa) ----------
// El formulario del hero es una versión compacta (nombre, teléfono, correo,
// monto) y el de #contacto agrega país, plataforma (opcional) y el checkbox
// de consentimiento. Ambos comparten la misma lógica de validación/envío:
// cada campo se identifica por su atributo "name" (igual en los dos
// formularios), aunque los "id" son distintos para no chocar en el DOM.

// URL del webhook de Google Apps Script que recibe los leads y los agrega
// como fila nueva en la Google Sheet del cliente. Ver instrucciones completas
// de cómo generarla más abajo, junto al fetch que la usa.
// Reemplazar PENDIENTE_URL_CLIENTE por la URL /exec que entregue el cliente
// al implementar su Google Apps Script.
const SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxbT4jT1MTKJh4pVFKn9_xWoyebLm8jTfBFrJfxZ884PHTtV-kH3fGl6QsrNPAxm1Bq/exec";

// Muestra un mensaje específico debajo de cada input cuando pierde el foco
// y es inválido, y lo quita en cuanto el usuario corrige el valor.
const FIELD_VALIDATORS = {
  nombre: (input) => (input.value.trim() === '' ? 'Este campo es obligatorio.' : ''),
  pais: (input) => (input.value.trim() === '' ? 'Escribe tu país.' : ''),
  telefono: (input) => {
    const value = input.value.trim();
    if (value === '') return 'Este campo es obligatorio.';
    if (!/^[+\d\s()-]{7,}$/.test(value)) return 'Ingresa un teléfono válido.';
    return '';
  },
  correo: (input) => {
    const value = input.value.trim();
    if (value === '') return 'Este campo es obligatorio.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Ingresa un correo válido.';
    return '';
  },
  monto: (input) => (input.value.trim() === '' ? 'Este campo es obligatorio.' : ''),
  consentimiento: (input) => (!input.checked ? 'Debes autorizar el tratamiento de tus datos.' : ''),
};

function setupLeadForm(formId, confirmId, fieldKeys) {
  const form = document.getElementById(formId);
  if (!form) return;
  const confirmMsg = document.getElementById(confirmId);
  const submitBtn = form.querySelector('.submit-btn');

  const idFor = (key) => form.querySelector(`[name="${key}"]`)?.id;

  function showFieldError(id, message) {
    const input = document.getElementById(id);
    const errorEl = document.getElementById(id + '-error');
    if (!input || !errorEl) return;
    const container = input.closest('.field, .consent');

    if (message) {
      errorEl.textContent = message;
      errorEl.classList.add('is-visible');
      if (container) container.classList.add('has-error');
    } else {
      errorEl.textContent = '';
      errorEl.classList.remove('is-visible');
      if (container) container.classList.remove('has-error');
    }
  }

  function validateField(key) {
    const id = idFor(key);
    const input = document.getElementById(id);
    if (!input) return true;
    const message = FIELD_VALIDATORS[key](input);
    showFieldError(id, message);
    return message === '';
  }

  fieldKeys.forEach((key) => {
    const id = idFor(key);
    const input = document.getElementById(id);
    if (!input) return;
    const eventName = input.type === 'checkbox' ? 'change' : 'input';

    input.addEventListener('blur', () => validateField(key));
    input.addEventListener(eventName, () => {
      const errorEl = document.getElementById(id + '-error');
      if (errorEl && errorEl.classList.contains('is-visible')) validateField(key);
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const allValid = fieldKeys.map(validateField).every(Boolean);
    if (!allValid) return;

    const payload = { fecha: new Date().toISOString() };
    ['nombre', 'pais', 'telefono', 'correo', 'monto', 'plataforma'].forEach((key) => {
      const id = idFor(key);
      payload[key] = id ? document.getElementById(id).value : '';
    });
    const consentId = idFor('consentimiento');
    if (consentId) payload.consentimiento = document.getElementById(consentId).checked;

    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
      // ============================================================
      // CONEXIÓN A GOOGLE SHEETS (vía Google Apps Script)
      //
      // El cliente no tiene CRM propio, así que los leads se guardan directo
      // en una Google Sheet mediante un webhook de Apps Script, sin necesidad
      // de un backend propio.
      //
      // CÓMO GENERAR LA URL DE SHEET_WEBHOOK_URL (lo hace el cliente una vez):
      //   1. Crea una Google Sheet nueva (ej. "Leads - Reclaim Assets Block").
      //   2. Ve a Extensiones > Apps Script.
      //   3. Borra el contenido de ejemplo y pega este código:
      //
      //        function doPost(e) {
      //          const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
      //          const data = JSON.parse(e.postData.contents);
      //          sheet.appendRow([
      //            data.nombre,
      //            data.telefono,
      //            data.correo,
      //            data.monto,
      //            data.plataforma,
      //            data.pais,
      //            data.fecha,
      //          ]);
      //          return ContentService
      //            .createTextOutput(JSON.stringify({ ok: true }))
      //            .setMimeType(ContentService.MimeType.JSON);
      //        }
      //
      //   4. Guarda el proyecto, luego "Implementar" > "Nueva implementación".
      //   5. Tipo de implementación: "Aplicación web".
      //   6. Acceso: "Cualquier usuario" (necesario para que el formulario
      //      público pueda enviar datos sin que el visitante inicie sesión).
      //   7. Copia la URL que genera Google y pégala arriba en
      //      SHEET_WEBHOOK_URL, reemplazando "PENDIENTE_URL_CLIENTE".
      //
      // Nota sobre "no-cors": Apps Script no permite lecturas CORS normales
      // desde el navegador, así que el fetch se hace en modo "no-cors". Esto
      // implica que la respuesta llega "opaca" (no podemos leer su contenido
      // ni su status real) — el fetch se resuelve igual si la red funcionó,
      // así que aquí solo detectamos errores de red/conexión, confiando en
      // que Apps Script procesó la fila correctamente del otro lado.
      //
      // Mientras el cliente no entregue su URL real, no intentamos el fetch
      // (fallaría contra un endpoint inexistente): solo avisamos en consola
      // para no romper el flujo visual de prueba del formulario.
      if (SHEET_WEBHOOK_URL === 'PENDIENTE_URL_CLIENTE') {
        console.warn('Falta configurar SHEET_WEBHOOK_URL con la URL real de Apps Script');
      } else {
        await fetch(SHEET_WEBHOOK_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      // ============================================================

      if (typeof fbq !== 'undefined') {
        fbq('track', 'Lead');
      }

      confirmMsg.classList.add('is-visible');
      submitBtn.textContent = 'Enviado ✓';
      form.reset();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
      alert('Hubo un problema al enviar tu información. Intenta de nuevo en unos minutos.');
    }
  });
}

setupLeadForm('lead-form', 'confirm-msg', ['nombre', 'pais', 'telefono', 'correo', 'monto', 'consentimiento']);
setupLeadForm('hero-lead-form', 'hero-confirm-msg', ['nombre', 'telefono', 'correo', 'monto']);


// ---------- Nav: leve cambio de opacidad al hacer scroll ----------
const nav = document.querySelector('.nav');
window.addEventListener('scroll', () => {
  if (window.scrollY > 12) {
    nav.style.background = 'rgba(243,241,234,0.92)';
  } else {
    nav.style.background = 'rgba(243,241,234,0.72)';
  }
}, { passive: true });
