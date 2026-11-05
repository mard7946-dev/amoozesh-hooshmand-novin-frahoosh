/* Shared Jalali date input/format utility for Frahoosh. Stored timestamps remain ISO-8601. */
(function (global) {
  'use strict';
  const tehran = 'Asia/Tehran';
  const digits = value => String(value ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const partsFormatter = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
    timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric'
  });
  function jalaliParts(date) {
    const p = partsFormatter.formatToParts(date);
    const get = type => Number(p.find(x => x.type === type)?.value || 0);
    return { y: get('year'), m: get('month'), d: get('day') };
  }
  function gregorianFromJalali(value) {
    const v = digits(value).trim();
    const m = v.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
    if (!m) throw new Error('تاریخ را به شکل ۱۴۰۵/۰۸/۰۸ وارد کنید.');
    const jy = Number(m[1]), jm = Number(m[2]), jd = Number(m[3]);
    if (jm < 1 || jm > 12 || jd < 1 || jd > 31) throw new Error('تاریخ شمسی معتبر نیست.');
    const center = Date.UTC(jy + 621, 2, 21);
    for (let offset = -2; offset <= 370; offset++) {
      const d = new Date(center + offset * 86400000);
      const p = jalaliParts(d);
      if (p.y === jy && p.m === jm && p.d === jd) return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
    }
    throw new Error('تاریخ شمسی معتبر پیدا نشد.');
  }
  const pad = n => String(n).padStart(2, '0');
  function toISODate(value) {
    if (!String(value ?? '').trim()) throw new Error('تاریخ شمسی را وارد کنید.');
    const g = gregorianFromJalali(value);
    return g.y + '-' + pad(g.m) + '-' + pad(g.d);
  }
  function toISODateTime(value) {
    const v = digits(value).trim();
    const m = v.match(/^(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})\s+(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error('تاریخ و ساعت را به شکل ۱۴۰۵/۰۸/۰۸ ۱۴:۳۰ وارد کنید.');
    const hh = Number(m[2]), mm = Number(m[3]);
    if (hh > 23 || mm > 59) throw new Error('ساعت واردشده معتبر نیست.');
    const date = toISODate(m[1]);
    return date + 'T' + pad(hh) + ':' + pad(mm) + ':00+03:30';
  }
  function fromISODate(value) {
    if (!value) return '';
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const p = jalaliParts(d);
    return p.y + '/' + pad(p.m) + '/' + pad(p.d);
  }
  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone: tehran, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date);
  }
  const monthNames = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const weekdays = ['ش','ی','د','س','چ','پ','ج'];
  const fa = value => String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  function todayJalali(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:tehran,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>Number(p.find(x=>x.type===t)?.value||0);return jalaliParts(new Date(Date.UTC(get('year'),get('month')-1,get('day'))));}
  function jalaliToUtc(jy,jm,jd) {
    const center=Date.UTC(jy+621,2,21);
    for(let offset=-2;offset<=370;offset++){const date=new Date(center+offset*86400000),p=jalaliParts(date);if(p.y===jy&&p.m===jm&&p.d===jd)return date;}
    throw new Error('تاریخ شمسی معتبر نیست.');
  }
  function attachPickers(root=document) {
    if(!document.getElementById('frahoosh-picker-style')){
      const style=document.createElement('style');style.id='frahoosh-picker-style';style.textContent=`
      .frahoosh-date-wrap{display:flex;gap:6px;align-items:center}.frahoosh-date-wrap input{flex:1;min-width:0}
      .frahoosh-date-button{border:1px solid #94a3b8;border-radius:8px;padding:9px 12px;background:#f8fafc;color:#172033;font:inherit;cursor:pointer;white-space:nowrap}
      .frahoosh-calendar-backdrop{position:fixed;inset:0;background:#0f172a88;z-index:99999;display:grid;place-items:center;padding:12px}
      .frahoosh-calendar{width:min(340px,100%);background:#fff;color:#172033;border-radius:16px;padding:14px;box-shadow:0 16px 50px #0004;font:14px Tahoma,Arial,sans-serif}
      .frahoosh-calendar-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
      .frahoosh-calendar button{font:inherit;cursor:pointer;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#172033;padding:7px 10px}
      .frahoosh-calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
      .frahoosh-calendar-grid span{padding:8px 0;color:#64748b}.frahoosh-calendar-grid button{padding:9px 0}
      .frahoosh-calendar-grid button[aria-pressed=true]{background:#166534;color:white;border-color:#166534}
      .frahoosh-calendar-foot{display:flex;justify-content:space-between;gap:8px;margin-top:12px}
      input[data-digital-time]{font-variant-numeric:tabular-nums;direction:ltr;text-align:center;min-height:42px}
      .frahoosh-time-wrap input{flex:1;min-width:0}.frahoosh-time-picker{width:min(360px,100%)}
      .frahoosh-time-fields{display:flex;align-items:end;justify-content:center;gap:12px}.frahoosh-time-fields label{display:grid;gap:6px;font-weight:600}.frahoosh-time-fields select{min-width:86px;padding:12px;border:1px solid #94a3b8;border-radius:9px;background:#fff;color:#172033;font:20px Tahoma,Arial,sans-serif;text-align:center}.frahoosh-time-fields>span{font-size:24px;padding-bottom:10px}.frahoosh-time-preview{font: bold 32px/1.5 Tahoma,Arial,sans-serif;direction:ltr;text-align:center;margin:4px 0 14px;font-variant-numeric:tabular-nums}.frahoosh-time-error{color:#b42318;min-height:20px}
      `;document.head.appendChild(style);
    }
    root.querySelectorAll('input[data-jalali-date]:not([data-jalali-ready])').forEach(input=>{
      input.dataset.jalaliReady='1';input.readOnly=true;input.autocomplete='off';input.setAttribute('aria-haspopup','dialog');
      const wrap=document.createElement('span');wrap.className='frahoosh-date-wrap';input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
      const open=document.createElement('button');open.type='button';open.className='frahoosh-date-button';open.textContent='📅 انتخاب تاریخ';open.setAttribute('aria-label','انتخاب تاریخ شمسی');wrap.appendChild(open);
      function show(){
        let jy,jm,jd;const match=digits(input.value).match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
        if(match){jy=+match[1];jm=+match[2];jd=+match[3];}else{const p=todayJalali();jy=p.y;jm=p.m;jd=p.d;}
        const backdrop=document.createElement('div');backdrop.className='frahoosh-calendar-backdrop';
        const panel=document.createElement('section');panel.className='frahoosh-calendar';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','تقویم شمسی');
        let viewY=jy,viewM=jm;
        function draw(){
          const first=jalaliToUtc(viewY,viewM,1),firstDay=(first.getUTCDay()+1)%7;
          const next=viewM===12?jalaliToUtc(viewY+1,1,1):jalaliToUtc(viewY,viewM+1,1);
          const count=Math.round((next-first)/86400000);
          const cells=weekdays.map(x=>'<span>'+x+'</span>').join('')+Array.from({length:firstDay},()=>'<span></span>').join('')+Array.from({length:count},(_,i)=>'<button type="button" data-day="'+(i+1)+'" aria-pressed="'+(viewY===jy&&viewM===jm&&i+1===jd)+'">'+fa(i+1)+'</button>').join('');
          panel.innerHTML='<div class="frahoosh-calendar-head"><button type="button" data-prev aria-label="ماه قبل">‹</button><strong>'+monthNames[viewM-1]+' '+fa(viewY)+'</strong><button type="button" data-next aria-label="ماه بعد">›</button></div><div class="frahoosh-calendar-grid">'+cells+'</div><div class="frahoosh-calendar-foot"><button type="button" data-today>امروز</button><button type="button" data-close>انصراف</button></div>';
          panel.querySelector('[data-prev]').onclick=()=>{if(--viewM<1){viewM=12;viewY--;}draw();};
          panel.querySelector('[data-next]').onclick=()=>{if(++viewM>12){viewM=1;viewY++;}draw();};
          panel.querySelector('[data-today]').onclick=()=>{const p=todayJalali();choose(p.y,p.m,p.d);};
          panel.querySelector('[data-close]').onclick=()=>backdrop.remove();
          panel.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>choose(viewY,viewM,Number(b.dataset.day)));
        }
        function choose(y,m,d){input.value=y+'/'+pad(m)+'/'+pad(d);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));backdrop.remove();}
        backdrop.onclick=e=>{if(e.target===backdrop)backdrop.remove();};backdrop.appendChild(panel);document.body.appendChild(backdrop);draw();
      }
      open.addEventListener('click',show);input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show();}});
    });
    root.querySelectorAll('input[data-digital-time]:not([data-digital-time-ready])').forEach(input=>{
      input.dataset.digitalTimeReady='1';input.type='text';input.readOnly=false;input.inputMode='text';input.lang='en';input.autocomplete='off';input.pattern='(?:[01][0-9]|2[0-3]):[0-5][0-9]';input.maxLength=5;input.placeholder='مثلاً ۱۴:۳۰';input.setAttribute('aria-haspopup','dialog');input.addEventListener('input',()=>{const value=digits(input.value).trim();input.setCustomValidity(value&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)?'ساعت را به شکل ۱۴:۳۰ وارد کنید.':'');});input.addEventListener('blur',()=>{input.value=digits(input.value).trim();});
      const wrap=document.createElement('span');wrap.className='frahoosh-date-wrap frahoosh-time-wrap';input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
      const open=document.createElement('button');open.type='button';open.className='frahoosh-date-button';open.textContent='🕒 انتخاب ساعت';open.setAttribute('aria-label','انتخاب ساعت دیجیتال');wrap.appendChild(open);
      function show(){
        const current=digits(input.value).match(/^(\d{1,2}):(\d{2})$/);let hour=current?Number(current[1]):'',minute=current?Number(current[2]):'';
        const backdrop=document.createElement('div');backdrop.className='frahoosh-calendar-backdrop';
        const panel=document.createElement('section');panel.className='frahoosh-calendar frahoosh-time-picker';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','انتخاب ساعت دیجیتال');
        const options=(max,selected)=>'<option value="">--</option>'+Array.from({length:max+1},(_,i)=>'<option value="'+pad(i)+'" '+(selected===i?'selected':'')+'>'+fa(pad(i))+'</option>').join('');
        panel.innerHTML='<h3>انتخاب ساعت دیجیتال</h3><p class="frahoosh-time-preview" data-preview>--:--</p><div class="frahoosh-time-fields"><label>ساعت (۰۰ تا ۲۳)<select data-hour dir="ltr">'+options(23,hour===''?-1:hour)+'</select></label><span>:</span><label>دقیقه (۰۰ تا ۵۹)<select data-minute dir="ltr">'+options(59,minute===''?-1:minute)+'</select></label></div><p class="frahoosh-time-error" data-error aria-live="polite"></p><div class="frahoosh-calendar-foot"><button type="button" data-clear>پاک کردن</button><button type="button" data-close>انصراف</button><button type="button" data-confirm>ثبت ساعت</button></div>';
        const hourSelect=panel.querySelector('[data-hour]'),minuteSelect=panel.querySelector('[data-minute]'),preview=panel.querySelector('[data-preview]'),error=panel.querySelector('[data-error]');
        function refresh(){preview.textContent=hourSelect.value&&minuteSelect.value?hourSelect.value+':'+minuteSelect.value:'--:--';error.textContent='';}
        hourSelect.addEventListener('change',refresh);minuteSelect.addEventListener('change',refresh);refresh();
        panel.querySelector('[data-close]').onclick=()=>backdrop.remove();
        panel.querySelector('[data-clear]').onclick=()=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));backdrop.remove();};
        panel.querySelector('[data-confirm]').onclick=()=>{if(!hourSelect.value||!minuteSelect.value){error.textContent='لطفاً ساعت و دقیقه را انتخاب کنید.';return;}input.value=hourSelect.value+':'+minuteSelect.value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));backdrop.remove();};
        backdrop.onclick=e=>{if(e.target===backdrop)backdrop.remove();};backdrop.appendChild(panel);document.body.appendChild(backdrop);
      }
      open.addEventListener('click',show);input.addEventListener('click',show);
    });
  }
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>attachPickers());
    else attachPickers();
  }
  global.FrahooshJalali = Object.freeze({ digits, toISODate, toISODateTime, fromISODate, formatDateTime, attachPickers });
})(window);
