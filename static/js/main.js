(function(){
var btn=document.querySelector('.menu-btn'),nav=document.getElementById('site-nav');
if(btn&&nav){
btn.addEventListener('click',function(){var o=nav.classList.toggle('open');btn.setAttribute('aria-expanded',o)});
nav.addEventListener('click',function(e){if(e.target.tagName==='A'){nav.classList.remove('open');btn.setAttribute('aria-expanded','false')}});
}
var here=location.pathname.split('/').pop()||'index.html';
document.querySelectorAll('#site-nav a[data-page]').forEach(function(a){
if(a.dataset.page===here)a.setAttribute('aria-current','page');
});
var ex=document.getElementById('expand-all'),co=document.getElementById('collapse-all');
function setAll(v){document.querySelectorAll('details.module').forEach(function(d){d.open=v})}
if(ex)ex.addEventListener('click',function(){setAll(true)});
if(co)co.addEventListener('click',function(){setAll(false)});
})();
