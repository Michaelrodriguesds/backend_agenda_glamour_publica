const B=process.env.BASE||'http://localhost:5055';
const j=async(m,u,b,t)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});let d;try{d=await r.json()}catch{};return{s:r.status,d}};
(async()=>{
 const e='logo'+Date.now()+'@t.com';
 const r=await j('POST','/api/auth/register',{email:e,password:'abc12345',businessName:'L',locations:['A']});
 const t=r.d.token; let ok=0,f=0; const c=(n,x)=>{x?ok++:f++;console.log(x?'  ok  ':'  FAIL',n)};
 const png='data:image/png;base64,'+Buffer.alloc(30000,1).toString('base64');
 const base={services:[{name:'X',price:10}],locations:['A']};
 let x=await j('PUT','/api/business/config',{...base,logoUrl:png},t); c('logo base64 aceita (200)',x.s===200);
 x=await j('GET','/api/business/config',null,t); c('logo volta igual',x.d.logoUrl===png);
 x=await j('PUT','/api/business/config',{...base,logoUrl:'data:image/png;base64,'+'A'.repeat(310000)},t); c('logo gigante recusada (400)',x.s===400);
 x=await j('PUT','/api/business/config',{...base,logoUrl:'data:text/html;base64,AAAA'},t); c('data:text/html recusado',x.s===400);
 x=await j('PUT','/api/business/config',{...base,logoUrl:'javascript:alert(1)'},t); c('javascript: recusado',x.s===400);
 x=await j('GET','/api/appointments',null,t); c('agenda funciona (cache sem logo)',x.s===200);
 x=await j('POST','/api/appointments',{clientName:'Z',procedures:['X'],date:'2026-11-02',time:'09:00',location:'A',price:10},t); c('cria agendamento após logo (200/201)',x.s===201);
 x=await j('GET','/api/availability?date=2026-11-02',null,t); c('disponibilidade ok',x.s===200);
 console.log(ok,'ok',f,'falhas');
})();
