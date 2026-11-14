"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[9568],{16191:(e,a,n)=>{n.d(a,{HM:()=>i});var t=n(2955),s=n(21348);function i({_cache:e=(0,t.b)(),_formatters:a=(0,t.c)(e),getMessageFallback:n=s.d,messages:p,namespace:r,onError:l=s.b,...o}){return function({messages:e,namespace:a,...n}){return e=e["!"],a=(0,s.r)(a,"!"),(0,s.a)({...n,messages:e,namespace:a})}({...o,onError:l,cache:e,formatters:a,getMessageFallback:n,messages:{"!":p},namespace:r?`!.${r}`:"!"})}},68406:(e,a,n)=>{n.d(a,{generateOrderSlipHtml:()=>r});var t=n(30283),s=n(83766),i=n(10382),p=n(44439);function r(e,a,n={}){let l=n.paperWidth??58,o=58===l?"4px":"6px",d=e=>(0,t.wH)(Number(e||0),n.country||"",n.currency||""),c=n.locale||"en",g="rtl"===n.direction?"rtl":"ltr",$=(e.items??[]).filter(e=>!(0,p.QR)(e.status)).map(e=>`
    <div style="margin:${o} 0;display:flex;justify-content:space-between;gap:8px;">
      <span>${(0,s.ZD)(e.quantity)}x ${(0,s.ZD)((0,i.R)(e.product_name,e.variant_selection))}</span>
      <span>${(0,s.ZD)(d(e.subtotal??e.unit_price*e.quantity))}</span>
    </div>
    ${(e.addons??[]).filter(e=>e?.name).map(e=>`
      <div style="padding-inline-start:1em;display:flex;justify-content:space-between;gap:8px;color:#444;">
        <span>+ ${(0,s.ZD)(e.name)}${(e.quantity??1)>1?` x${(0,s.ZD)(e.quantity)}`:""}</span>
        ${e.price?`<span>${(0,s.ZD)(d(e.price))}</span>`:""}
      </div>
    `).join("")}
    ${e.special_instructions?`<div style="padding-inline-start:1em;font-style:italic;">&gt;&gt; ${(0,s.ZD)(e.special_instructions)}</div>`:""}
  `).join("");return`
    <div class="order-slip" lang="${(0,s.ZD)(c)}" dir="${g}" style="width:100%;max-width:${58===l?"58mm":"80mm"};min-width:0;box-sizing:border-box;overflow-wrap:anywhere;word-break:break-word;padding:${o};font-family:'Courier New','Noto Sans Bengali','Nirmala UI','Vrinda','Bangla Sangam MN','Noto Sans Devanagari','Kohinoor Devanagari','Devanagari Sangam MN','Noto Sans Thai','Leelawadee UI',Thonburi,monospace;font-size:${58===l?"10px":"12px"};direction:${g};text-align:${"rtl"===g?"right":"left"};">
      <h2 style="margin:0 0 ${o} 0;font-size:${58===l?"14px":"16px"};text-align:center;">${(0,s.ZD)(a.title)}</h2>
      <p style="margin:2px 0;font-weight:bold;">#${(0,s.ZD)(e.order_number)}</p>
      ${e.table?.name?`<p style="margin:2px 0;">${(0,s.ZD)(e.table.name)}</p>`:""}
      <hr style="border:1px dashed #000;margin:${o} 0;">
      ${$}
      <hr style="border:1px dashed #000;margin:${o} 0;">
      <div style="display:flex;justify-content:space-between;"><span>${(0,s.ZD)(a.subtotal)}</span><span>${(0,s.ZD)(d(e.subtotal))}</span></div>
      ${e.discount_amount?`<div style="display:flex;justify-content:space-between;"><span>${(0,s.ZD)(a.discount)}</span><span>-${(0,s.ZD)(d(e.discount_amount))}</span></div>`:""}
      ${e.service_charge?`<div style="display:flex;justify-content:space-between;"><span>${(0,s.ZD)(a.serviceCharge)}</span><span>${(0,s.ZD)(d(e.service_charge))}</span></div>`:""}
      ${e.delivery_charge?`<div style="display:flex;justify-content:space-between;"><span>${(0,s.ZD)(a.deliveryCharge)}</span><span>${(0,s.ZD)(d(e.delivery_charge))}</span></div>`:""}
      ${e.packaging_charge?`<div style="display:flex;justify-content:space-between;"><span>${(0,s.ZD)(a.packagingCharge)}</span><span>${(0,s.ZD)(d(e.packaging_charge))}</span></div>`:""}
      ${e.tax_amount?`<div style="display:flex;justify-content:space-between;"><span>${(0,s.ZD)(a.tax)}</span><span>${(0,s.ZD)(d(e.tax_amount))}</span></div>`:""}
      <div style="display:flex;justify-content:space-between;font-weight:bold;margin-top:${o};"><span>${(0,s.ZD)(a.total)}</span><span>${(0,s.ZD)(d(e.total))}</span></div>
    </div>
  `}}}]);