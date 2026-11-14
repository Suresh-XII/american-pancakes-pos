"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[1385],{83766:(t,e,a)=>{a.d(e,{ZD:()=>m,mj:()=>b,printWebBill:()=>u});var r=a(3290),n=a(38434),i=a(30283),o=a(74190),l=a(40980);a(55655);var d=a(8509),s=a(83749),c=a(58487),p=a(65287);function m(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function g(t,e){return t?"ltr"===t.direction&&"rtl"===e?`<span class="ltr" dir="ltr">${m(t.text)}</span>`:m(t.text):""}async function u(t,e,a={},r){let i,o,l=h(a),s=void 0===r?window.open("","_blank","width=800,height=600"):r;if(!s)throw n.Ay.error("Please allow popups to print bills"),Error("Popup window was blocked by browser");try{i=(await (0,d.OG)(l)).map(t=>({field:"receipt language",text:t,message:`Receipt language "${t}" could not be loaded, so English labels were used. Check the locale bundle and retry.`,kind:"locale"})),o=b(t,e,{...a,languages:l})}catch(t){throw s.closed||s.close(),t}if(s.closed)throw Error("Print window was closed before receipt could be printed");return new Promise((t,e)=>{let a=!1,r=null,i=n=>{a||(a=!0,r&&(clearInterval(r),r=null),n?(s.closed||s.close(),e(n)):t())},l=()=>{if(!a)try{if(s.closed)return void i(Error("Print window was closed before receipt could be printed"));s.print(),i()}catch(t){console.error("Failed to trigger print on window:",t),n.Ay.error("Failed to open print dialog"),i(t instanceof Error?t:Error(String(t)))}};try{if(s.document.open(),s.document.write(o),s.document.close(),"complete"===s.document.readyState)l();else{s.onload=()=>{l()};let t=0;r=setInterval(()=>{t+=50,s.closed?i(Error("Print window was closed before receipt could be printed")):("complete"===s.document.readyState||t>=3e3)&&l()},50)}}catch(t){console.error("Failed to write receipt to print window:",t),n.Ay.error("Failed to open print dialog"),i(t instanceof Error?t:Error(String(t)))}}).then(()=>i)}function b(t,e,a={}){var n;let{paperSize:u="thermal58",includeTaxId:w=!1,taxRegistrationNumber:f,address:v,phone:N,footerNote:k,businessName:C,showBusinessName:I=!0,showLogo:S=!1,receiptLogo:T,receiptLogoRaster:B,showTaxBreakdown:E=!0,showCustomerName:_=!0,showCustomerPhone:j=!0,deliveryShowCustomerPhoneAlways:z,showTableNumber:D=!0,isReprint:P=!1,trimDecimals:F=!1}=a,L=h(a),A=L[0],O=(0,d.Zt)(t,e,{columns:a.columns??(0,o.Ij)("thermal80"===u?80:58),businessName:I?C??e.business_name:void 0,address:v,phone:N,footerNote:k,taxRegistrationNumber:f,includeTaxId:w&&!!f,taxIdLabel:(n=e.country,n?.toUpperCase()==="IR"?(0,d.wv)("receipt.economicCode",A):(0,i.jM)(n??"")?.taxIdLabel||"Tax ID"),showBusinessName:I,showLogo:S,receiptLogo:T,receiptLogoRaster:B,showTaxBreakdown:E,showCustomerName:_,showCustomerPhone:j,deliveryShowCustomerPhoneAlways:z,showTableNumber:D,isReprint:P,trimDecimals:F,languages:L}),H=O.direction.base,Y=c.Yj[A]?.locale??A,M=(0,p.gd)(O,"business-header"),R=(0,p.gd)(O,"document-meta"),J=(0,p.gd)(O,"customer"),U=(0,p.gd)(O,"item-table"),q=(0,p.gd)(O,"tax-breakdown"),K=(0,p.gd)(O,"totals"),W=(0,p.gd)(O,"payments"),Z=(0,p.gd)(O,"message"),G=x(R?.table?.label,"pos.tableLabel",A),Q={billNumber:x(R?.billNumberLabel,"receipt.billNumber",A),date:x(R?.dateLabel,"receipt.date",A),table:G.replace("{name}","").replace(/[:：]\s*$/,"").trim(),customer:x(J?.nameLabel,"pos.customer",A),customerNo:x(J?.phoneLabel,"print.numberShort",A),deliveryAddress:x(J?.addressLabel,"print.deliverySlip.address",A),rate:U?.header.rate.primary??(0,d.wv)("receipt.rate",A),totalTax:y(K?.tax?.label,"pos.tax","receipt.totalTax",A),deliveryCharge:y(K?.deliveryCharge?.label,"pos.delivery","receipt.deliveryCharge",A),packagingCharge:x(K?.packagingCharge?.label,"pos.packaging",A),grandTotal:y(K?.grandTotal?.label,"print.grandTotal","receipt.grandTotal",A),taxDetails:q?.heading.primary??(0,d.wv)("receipt.taxDetails",A),paymentsHeader:W?.heading.primary??(0,d.wv)("receipt.payments",A),thankYou:y(Z?.thankYou,"print.thankYouShort","receipt.thankYou",A),taxIncluded:Z?.taxIncluded.primary??(0,d.wv)("receipt.taxIncluded",A),printBill:(0,d.wv)("receipt.printBill",A)},V=Q.billNumber,X=function(t){let e=`
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Segoe UI', Tahoma, 'Noto Naskh Arabic', 'Noto Sans Bengali', 'Vrinda', 'Bangla Sangam MN', 'Noto Sans Devanagari', 'Nirmala UI', 'Kohinoor Devanagari', 'Devanagari Sangam MN', 'Noto Sans Thai', 'Leelawadee UI', Thonburi, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK JP', 'Noto Sans JP', 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 1.4; color: #333; }
    body:lang(zh-TW) { font-family: -apple-system, 'Segoe UI', Tahoma, 'Noto Naskh Arabic', 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans CJK TC', 'Noto Sans TC', 'Helvetica Neue', Arial, sans-serif; }
    .bill-container { max-width: 100%; margin: 0 auto; }
    .reprint-banner { text-align: center; font-size: 22px; font-weight: bold; letter-spacing: 2px; color: #c00; border: 3px solid #c00; padding: 6px; margin-bottom: 15px; }
    .online-order-banner { text-align: center; font-size: 18px; font-weight: bold; letter-spacing: 1px; border: 2px solid #333; padding: 6px; margin-bottom: 15px; }
    .online-order-banner .online-order-detail { font-size: 13px; font-weight: normal; letter-spacing: normal; margin-top: 2px; }
    .header { text-align: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #ccc; }
    .receipt-logo { max-width: 80%; max-height: 120px; object-fit: contain; margin: 0 auto 8px auto; display: block; }
    .header h1 { font-size: 24px; margin-bottom: 5px; }
    .bill-details { margin-bottom: 15px; }
    .bill-details table { width: 100%; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
    .items-table th, .items-table td { padding: 8px; border-bottom: 1px solid #eee; text-align: start; }
    .items-table th { background: #f5f5f5; font-weight: bold; }
    .tax-table, .payments-table { width: 50%; margin-inline-start: 50%; border-collapse: collapse; margin-bottom: 15px; }
    .tax-table th, .tax-table td, .payments-table th, .payments-table td { padding: 6px 8px; }
    .tax-table th, .payments-table th { background: #f9f9f9; text-align: start; }
    .totals-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
    .totals-table td { padding: 6px 8px; }
    .total-row { border-top: 2px solid #333; font-size: 16px; }
    .footer { text-align: center; margin-top: 30px; padding-top: 15px; border-top: 1px solid #ccc; }
    .powered-by { font-size: 10px; margin-top: 8px; color: #555; }
    .text-end { text-align: end !important; }
    .num { unicode-bidi: isolate; white-space: nowrap; }
    .ltr { direction: ltr; unicode-bidi: isolate; }
    .text-muted { color: #666; }
    .text-italic { font-style: italic; color: #888; }
  `;switch(t){case"thermal58":return e+`
        .bill-container { padding: 5px; max-width: 58mm; font-size: 10px; }
        .header h1 { font-size: 14px; }
        .items-table th, .items-table td, .tax-table td, .totals-table td, .payments-table td { padding: 2px 4px; }
      `;case"thermal80":return e+`
        .bill-container { padding: 10px; max-width: 80mm; font-size: 11px; }
        .header h1 { font-size: 16px; }
      `;default:return e}}(u),tt=U?.rows??[],te=(0,r.kW)(K?.chargesBreakdown),ta=new Set(te.map(t=>t.id)),tr=K?.tax!=null||null!=q&&q.lines.length>0;return`<!DOCTYPE html>
<html lang="${Y}" dir="${H}">
<head>
  <meta charset="utf-8">
  <title>${m(V)} ${m(R?.invoiceNumber.text??"")}</title>
  <style>
    ${X}
    @media print {
      .no-print { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="bill-container">
    ${Z?.reprintBanner?`<div class="reprint-banner">${m(Z.reprintBanner.primary)}</div>`:""}
    ${Z?.onlineOrderBanner?`<div class="online-order-banner">${m(Z.onlineOrderBanner.label.primary)}${Z.onlineOrderBanner.platform.text?`<div class="online-order-detail">${m(Z.onlineOrderBanner.platform.text)}</div>`:""}${Z.onlineOrderBanner.externalOrderId.text?`<div class="online-order-detail">#${m(Z.onlineOrderBanner.externalOrderId.text)}</div>`:""}</div>`:""}
    \x3c!-- Header --\x3e
    <div class="header">
      ${M?.logo&&M.logo.startsWith("data:image/")?`<div class="logo-container"><img class="receipt-logo" src="${m(M.logo)}" alt="Logo" /></div>`:""}
      ${M?.name?`<h1>${m(M.name.text)}</h1>`:""}
      ${M?.address?`<p>${m(M.address.text).replace(/\n/g,"<br>")}</p>`:""}
      ${M?.phone&&M.phoneLabel?`<p>${m(M.phoneLabel.primary)}: ${g(M.phone,H)}</p>`:""}
      ${M?.taxId?`<p>${m(M.taxId.label.primary)}: ${g(M.taxId.value,H)}</p>`:""}
    </div>

    \x3c!-- Bill Details --\x3e
    <div class="bill-details">
      <table>
        <tr>
          <td><strong>${m(V)}</strong> ${R?g(R.invoiceNumber,H):""}</td>
          <td class="text-end"><strong>${m(Q.date)}</strong> ${R?m(function(t,e,a){if(!t)return"";try{let r=(0,l.AK)(t);if(isNaN(r.getTime()))return t;return(0,i.nN)(r,e.country,e.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,{digits:e.number_digits,calendar:e.calendar},{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"},a)}catch{return t}}(R.timestamp.text,e,c.Yj[A]?.locale??A)):""}</td>
        </tr>
        ${R?.table?`<tr><td><strong>${m(Q.table)}</strong> ${m(R.table.name.text)}</td><td></td></tr>`:""}
        ${J?.heading?`<tr><td colspan="2"><strong>${m(J.heading.primary)}</strong></td></tr>`:""}
        ${J?.name?`<tr><td><strong>${m(Q.customer)}</strong> ${m(J.name.text)}</td><td></td></tr>`:""}
        ${J?.phone?`<tr><td><strong>${m(Q.customerNo)}</strong> ${g(J.phone,H)}</td><td></td></tr>`:""}
        ${J?.address?`<tr><td><strong>${m(Q.deliveryAddress)}</strong> ${g(J.address,H).replace(/\n/g,"<br>")}</td><td></td></tr>`:""}
      </table>
    </div>

    \x3c!-- Items Table --\x3e
    <table class="items-table">
      <thead>
        <tr>
          <th>${m(U?.header.item.primary??"")}</th>
          <th class="text-end">${m(U?.header.quantity.primary??"")}</th>
          <th class="text-end">${m(Q.rate)}</th>
          <th class="text-end">${m(U?.header.amount.primary??"")}</th>
        </tr>
      </thead>
      <tbody>
        ${tt.map(t=>{let a;return`
          <tr>
            <td>
              ${m(t.name.text)}
              ${t.addons.length>0?`<br><small class="text-muted">${t.addons.map(t=>`+ ${m(t.name.text)}${(t.quantity??1)>1?` \xd7${m(t.quantity)}`:""}${t.price>0?` (${$(t.price,e,F)})`:""}`).join(", ")}</small>`:""}
              ${t.specialInstructions?`<br><small class="text-italic">${m(t.specialInstructions.text)}</small>`:""}
            </td>
            <td class="text-end num">${a=t.quantity,(0,i.w4)(Number(a)||0,e.country,{digits:e.number_digits})}</td>
            <td class="text-end num">${$(t.unitPrice??0,e,F)}</td>
            <td class="text-end num">${$(t.amount,e,F)}</td>
          </tr>
        `}).join("")}
      </tbody>
    </table>

    \x3c!-- Tax Breakdown --\x3e
    ${q&&q.lines.length>0?`
    <table class="tax-table">
      <thead>
        <tr><th colspan="2">${m(Q.taxDetails)}</th></tr>
      </thead>
      <tbody>
        ${q.lines.map(t=>`
          <tr><td>${m(null===t.rate?t.label.primary:`${t.label.primary} @${t.rate}%`)}</td><td class="text-end num">${$(t.amount,e,F)}</td></tr>
        `).join("")}
      </tbody>
    </table>
    `:""}

    \x3c!-- Totals --\x3e
    <table class="totals-table">
      ${K?`
      ${K.pointsRedeemed?`<tr><td>${m(K.pointsRedeemed.label.primary)}</td><td class="text-end num">-${m(K.pointsRedeemed.points)} pts</td></tr>`:""}
      <tr><td>${m(K.subtotal.label.primary)}</td><td class="text-end num">${$(K.subtotal.amount,e,F)}</td></tr>
      ${K.discount?`<tr><td>${m(K.discount.label.primary)}</td><td class="text-end num">-${$(K.discount.amount,e,F)}</td></tr>`:""}
      ${K.tax?`<tr><td>${m(Q.totalTax)}</td><td class="text-end num">${$(K.tax.amount,e,F)}</td></tr>`:""}
      ${K.serviceCharge&&!ta.has("service_charge")?`<tr><td>${m(K.serviceCharge.label.primary)}</td><td class="text-end num">${$(K.serviceCharge.amount,e,F)}</td></tr>`:""}
      ${K.deliveryCharge?`<tr><td>${m(Q.deliveryCharge)}</td><td class="text-end num">${$(K.deliveryCharge.amount,e,F)}</td></tr>`:""}
      ${K.packagingCharge&&!ta.has("packaging_charge")?`<tr><td>${m(Q.packagingCharge)}</td><td class="text-end num">${$(K.packagingCharge.amount,e,F)}</td></tr>`:""}
      ${te.map(t=>`<tr><td>${m(t.name)}</td><td class="text-end num">${$(t.amount,e,F)}</td></tr>`).join("")}
      <tr class="total-row"><td><strong>${m(Q.grandTotal)}</strong></td><td class="text-end num"><strong>${$(K.grandTotal.amount,e,F)}</strong></td></tr>
      ${K.pointsEarned?`<tr><td>${m(K.pointsEarned.label.primary)}</td><td class="text-end num">${m(K.pointsEarned.points)} pts</td></tr>`:""}
      ${K.pointsBalance?`<tr><td>${m(K.pointsBalance.label.primary)}</td><td class="text-end num">${m(K.pointsBalance.points)} pts</td></tr>`:""}
      `:""}
    </table>

    \x3c!-- Payments --\x3e
    ${W&&W.lines.length>0?`
    <table class="payments-table">
      <thead>
        <tr><th colspan="2">${m(Q.paymentsHeader)}</th></tr>
      </thead>
      <tbody>
        ${W.lines.map(t=>(0,p.a2)(t).map(t=>{var a;return`
          <tr><td>${m(void 0!==(a=t.label).conceptId?a.primary:a.primary.charAt(0).toUpperCase()+a.primary.slice(1))}</td><td class="text-end num">${$(t.amount,e,F)}</td></tr>
        `}).join("")).join("")}
      </tbody>
    </table>
    `:""}

    \x3c!-- Footer --\x3e
    <div class="footer">
      ${Z?.footerNote?`<p>${m(Z.footerNote.text)}</p>`:`<p>${m(Q.thankYou)}</p>`}
      ${tr?`<p>${m(Q.taxIncluded)}</p>`:""}
      <p class="powered-by">${m(s.PC)}</p>
    </div>
  </div>

  <div class="no-print" style="text-align:center;margin-top:20px;">
    <button onclick="window.print()" style="padding:10px 20px;font-size:16px;cursor:pointer;">${m(Q.printBill)}</button>
  </div>
</body>
</html>
  `}function h(t){return t.languages??(0,d.Si)(t.language)}function x(t,e,a){return t?.primary??(0,d.wv)(e,a)}function y(t,e,a,r){let n=(0,d.wv)(e,r);return t&&t.primary!==n?t.primary:(0,d.wv)(a,r)}function $(t,e,a=!1){let r=Number.isFinite(Number(t))?Number(t):0,n={currencyDisplay:e.currency_display,digits:e.number_digits},o=(0,i.EJ)(e.currency),l=10**o,d=o>0&&Math.round(r*l)%l!=0,s=("IRR"===e.currency||!e.currency&&"IR"===e.country)&&("toman"===e.currency_display||"toman_short"===e.currency_display);if(a&&!d&&!s){let t=(0,i.jM)(e.country)?.locale??"en-US",a="latin"===e.number_digits?"latn":void 0,o=e.currency;try{return new Intl.NumberFormat(t,{style:"currency",currency:o,currencyDisplay:(0,i.Qn)(o,t)===o?"code":"narrowSymbol",...a?{numberingSystem:a}:{},minimumFractionDigits:0,maximumFractionDigits:0}).format(r)}catch{return(0,i.wH)(r,e.country,e.currency,n)}}return(0,i.wH)(r,e.country,e.currency,n)}}}]);