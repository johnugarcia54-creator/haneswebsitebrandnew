/* =========================================================================================
   Hanes enquiries (front end). Every form on the site sends through /api/enquiry, so an
   enquiry goes straight to the Hanes inbox, with no email app in between (see api/enquiry.js).

   HanesEnquiry.submit(form, { subject, form, fields: [[label, value], …], status, done })
     sends a form the page has already checked, and reports back in the status element.
   Links with data-quote="Topic" open a short enquiry form in a dialog, on any page. Their
     href (contact.html?topic=…#enquiry) still works without JavaScript.
   ========================================================================================= */
window.HanesEnquiry = (() => {
  'use strict';
  const MAIL = 'Enquiry@hanesdistribution.co.nz', API = '/api/enquiry', t0 = Date.now();
  const online = location.protocol === 'http:' || location.protocol === 'https:';
  const REGIONS = ['Northland', 'Auckland', 'Waikato', 'Bay of Plenty', 'Gisborne', "Hawke's Bay", 'Taranaki', 'Manawatū-Whanganui', 'Wellington', 'Tasman', 'Nelson', 'Marlborough', 'West Coast', 'Canterbury', 'Otago', 'Southland', 'Outside New Zealand'];
  const $ = (s, r = document) => r.querySelector(s);

  // a field people never see and bots fill in
  const trap = form => {
    if (form.querySelector('input[name="website"]')) return;
    const w = document.createElement('div');
    w.setAttribute('aria-hidden', 'true');
    w.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden';
    w.innerHTML = '<label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label>';
    form.append(w);
  };
  const say = (el, text, kind) => {
    if (!el) return;
    el.textContent = text;
    el.classList.add('is-on'); el.classList.toggle('is-err', kind === 'err'); el.classList.toggle('is-ok', kind === 'ok');
  };
  const mailto = (subject, name, email, fields) => {
    const body = [subject, '', `Name: ${name}`, `Email: ${email}`, ...fields.map(([k, v]) => `${k}: ${v}`)].join('\n');
    return `mailto:${MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  /* ---------- Send a form ---------- */
  async function submit(form, o = {}) {
    if (form.dataset.sending) return false;
    const el = form.elements, status = o.status || null;
    const name = String(o.name ?? (el.name && el.name.value) ?? '').trim();
    const email = String(o.email ?? (el.email && el.email.value) ?? '').trim();
    const subject = String(o.subject || 'Website enquiry').trim();
    const fields = (o.fields || []).map(([k, v]) => [k, v == null ? '' : String(v).trim()]).filter(([, v]) => v);
    const btn = form.querySelector('[type="submit"]'), text = btn && btn.textContent.trim() ? btn.innerHTML : null;
    form.dataset.sending = '1'; form.setAttribute('aria-busy', 'true');
    if (btn) { btn.disabled = true; if (text) btn.textContent = 'Sending…'; else btn.classList.add('is-busy'); }
    if (status) status.classList.remove('is-on', 'is-err', 'is-ok');
    let ok = false;
    try {
      let r = null, j = {};
      if (online) {
        r = await fetch(API, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, subject, form: o.form || form.id || 'form', page: location.pathname, fields, website: el.website ? el.website.value : '', elapsed: Date.now() - t0 })
        });
        j = await r.json().catch(() => ({}));
      }
      if (r && r.ok) {
        ok = true;
        say(status, o.done || `Thanks, ${name.split(' ')[0]}. Your enquiry is with our team, and we'll reply to ${email}.`, 'ok');
        form.reset();
      } else if (r && r.status === 400) {
        say(status, j.error || 'Please check the form and try again.', 'err');
        const f = j.field && el[j.field]; if (f && f.focus) f.focus();
      } else if (r && r.status === 429) {
        say(status, `You've sent a few enquiries in a row. Please wait a few minutes and try again, or email us at ${MAIL}.`, 'err');
      } else throw new Error('unavailable');
    } catch (e) {
      // the website couldn't send it (offline, or email not set up yet): hand it to the email app so nothing is lost
      location.href = mailto(subject, name, email, fields);
      say(status, `We couldn't send this from the website just now, so your email app has opened with everything filled in. If it didn't open, email us at ${MAIL}.`, 'err');
    } finally {
      delete form.dataset.sending; form.removeAttribute('aria-busy');
      if (btn) { btn.disabled = false; if (text) btn.innerHTML = text; else btn.classList.remove('is-busy'); }
    }
    return ok;
  }

  /* ---------- The enquiry dialog, opened by any data-quote link ---------- */
  let dlg = null, trigger = null, topic = '', subj = '';
  const build = () => {
    dlg = document.createElement('dialog');
    dlg.className = 'qd'; dlg.setAttribute('aria-labelledby', 'qdTitle'); dlg.setAttribute('data-lenis-prevent', '');
    dlg.innerHTML = `
      <form class="qd__form" id="quoteForm" novalidate>
        <button class="qd__x" type="button" aria-label="Close"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12"/></svg></button>
        <p class="qd__eyebrow" id="qdTopic"></p>
        <h2 class="qd__title" id="qdTitle">Tell us what you need.</h2>
        <p class="qd__sub">It goes straight to our team, and we'll reply by email.</p>
        <div class="qd__grid">
          <label class="qd__f"><span>Your name</span><input name="name" required autocomplete="name" maxlength="120"></label>
          <label class="qd__f"><span>Email</span><input name="email" type="email" required autocomplete="email" maxlength="254"></label>
          <label class="qd__f"><span>Phone <em>(optional)</em></span><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
          <label class="qd__f"><span>Business <em>(optional)</em></span><input name="business" autocomplete="organization" maxlength="120"></label>
          <label class="qd__f qd__f--full"><span>Region <em>(optional)</em></span><select name="region"><option value="">Choose one</option>${REGIONS.map(r => `<option>${r}</option>`).join('')}</select></label>
          <label class="qd__f qd__f--full"><span>What do you need?</span><textarea name="message" rows="4" required maxlength="5000"></textarea></label>
        </div>
        <button class="qd__send" type="submit">Send enquiry</button>
        <p class="qd__status" id="qdStatus" role="status" aria-live="polite"></p>
        <p class="qd__note">Sent to ${MAIL}. We only use your details to reply to you.</p>
      </form>`;
    document.body.append(dlg);
    const f = $('form', dlg);
    trap(f);
    $('.qd__x', dlg).addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { document.documentElement.classList.remove('qd-open'); if (trigger && trigger.focus) trigger.focus({ preventScroll: true }); });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!f.reportValidity()) return;
      const v = k => f.elements[k].value.trim();
      const sent = await submit(f, { subject: subj, form: 'quote dialog', status: $('#qdStatus', dlg),
        fields: [['Topic', topic], ['Phone', v('phone')], ['Business', v('business')], ['Region', v('region')], ['Message', v('message')]] });
      if (sent) $('.qd__send', dlg).textContent = 'Sent';
      $('#qdStatus', dlg).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };
  const open = (t, s, hint, from) => {
    if (!dlg) build();
    const f = $('form', dlg);
    topic = t || 'General enquiry'; subj = s || topic; trigger = from || document.activeElement;
    $('#qdTopic', dlg).textContent = topic;
    f.elements.message.placeholder = hint || '';
    $('.qd__send', dlg).textContent = 'Send enquiry';
    $('#qdStatus', dlg).classList.remove('is-on', 'is-err', 'is-ok');
    document.documentElement.classList.add('qd-open');
    dlg.showModal();
    setTimeout(() => f.elements.name.focus(), 30);
  };

  const init = () => {
    document.querySelectorAll('form').forEach(trap);
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('[data-quote]');
      if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || typeof HTMLDialogElement === 'undefined') return;
      e.preventDefault();
      open(a.dataset.quote, a.dataset.quoteSubject, a.dataset.quoteHint, a);
    });
    // contact.html?topic=… picks that topic in the enquiry form
    const t = new URLSearchParams(location.search).get('topic'), sel = t && document.querySelector('select[name="topic"]');
    if (sel && [...sel.options].some(o => o.value === t || o.text === t)) { sel.value = t; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { submit, open, MAIL };
})();
