(()=>{'use strict';
const script=[...document.scripts].find(s=>/panel-navigation\.js(?:\?|$)/.test(s.src));
if(!script||document.getElementById('frahooshPanelBack'))return;
const role=(sessionStorage.getItem('frahoosh_novin_role')||new URLSearchParams(location.search).get('role')||'').trim().toLowerCase();
const token=sessionStorage.getItem('frahoosh_novin_access_token')||'';
const allowed=new Set(['manager','deputy','teacher','parent','student','counselor']);
const root=new URL('.',script.src);
const portal=new URL('portal.html',root);
const button=document.createElement('button');
button.id='frahooshPanelBack';button.type='button';button.textContent='← بازگشت به منوی پنل';
button.setAttribute('aria-label','بازگشت به منوی پنل قبلی');
button.style.cssText='position:fixed;z-index:2147483000;top:12px;left:12px;min-height:44px;padding:10px 14px;border:1px solid #63e0c0;border-radius:12px;background:#102b40;color:#f4f7ff;font:700 13px Tahoma, sans-serif;box-shadow:0 4px 18px #0005;cursor:pointer;direction:rtl';
button.addEventListener('click',()=>{
 const target=new URL(portal.href);
 if(allowed.has(role)){
  target.searchParams.set('step',token?'panel':'login');
  target.searchParams.set('role',role);
 }else{
  target.searchParams.set('step','home');target.searchParams.delete('role');
 }
 location.assign(target.href);
});
document.body.append(button);
})();