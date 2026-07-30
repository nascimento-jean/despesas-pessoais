const CATEGORIES=[
  {name:"Moradia",color:"#7957ff",icon:"⌂"},{name:"Alimentação",color:"#ff8a5c",icon:"◒"},
  {name:"Transporte",color:"#18aa94",icon:"↗"},{name:"Saúde",color:"#ed5572",icon:"+"},
  {name:"Educação",color:"#4387e8",icon:"◇"},{name:"Lazer",color:"#dda324",icon:"✦"},
  {name:"Assinaturas",color:"#9b67d9",icon:"◎"},{name:"Outros",color:"#78838f",icon:"••"}
];
const STORE="despesas-pessoais-v2",LEGACY="despesas-pessoais-github-v1",PERSONAL_STORE="despesas-pessoais-personal-v2",ACTIVE_HOUSEHOLD="despesas-pessoais-household";
const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0);
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;
const nowMonth=()=>new Date().toISOString().slice(0,7);
const monthName=key=>new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${key}-02T12:00:00Z`));
const category=name=>CATEGORIES.find(c=>c.name===name)||CATEGORIES.at(-1);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const monthShift=(key,delta)=>{const [y,m]=key.split("-").map(Number),d=new Date(Date.UTC(y,m-1+delta,1));return`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`};
const dueFor=(month,day)=>{const [y,m]=month.split("-").map(Number),last=new Date(y,m,0).getDate();return`${month}-${String(Math.min(Number(day)||1,last)).padStart(2,"0")}`};
const blankMonth=(income=0,investment=0)=>({income,investment,expenses:[],budgets:{}});

function initialState(){
  const current=nowMonth(),legacy=JSON.parse(localStorage.getItem(LEGACY)||"null");
  const month=blankMonth(legacy?.income??5200,legacy?.investment??500);
  if(Array.isArray(legacy?.expenses))month.expenses=legacy.expenses.map(e=>({...e,description:e.description||"Despesa",seriesId:e.seriesId||null,cardId:e.cardId||"",installment:e.installment||1,totalInstallments:e.totalInstallments||1}));
  return{version:2,selectedMonth:current,months:{[current]:month},cards:[],goals:[],settings:{notifications:false}};
}
function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORE)||"null");
    if(saved?.version===2&&saved.months)return saved;
  }catch{}
  return initialState();
}
let state=loadState(),filter="Todos",query="",editing=null,installPrompt=null,deletedUndo=null;
let cloud={client:null,user:null,households:[],active:null,role:null,channel:null,revision:0,applying:false,saveTimer:null,lastEditor:null,lastUpdate:null};
document.body.classList.toggle("dark",localStorage.getItem("despesas-pessoais-theme")==="dark");
const $=selector=>document.querySelector(selector);
function persist(){
  localStorage.setItem(STORE,JSON.stringify(state));
  if(cloud.active&&!cloud.applying)queueCloudSave();
}
function current(){return state.months[state.selectedMonth]||(state.months[state.selectedMonth]=blankMonth())}
function totals(month=current()){
  const total=month.expenses.reduce((s,e)=>s+Number(e.value),0),paid=month.expenses.filter(e=>e.paid).reduce((s,e)=>s+Number(e.value),0);
  return{total,paid,pending:total-paid,balance:Number(month.income)-total-Number(month.investment),committed:month.income?total/month.income*100:0,investmentRate:month.income?month.investment/month.income*100:0};
}
function byCategory(month=current()){
  return CATEGORIES.map(c=>({...c,value:month.expenses.filter(e=>e.category===c.name).reduce((s,e)=>s+Number(e.value),0)})).filter(c=>c.value>0).sort((a,b)=>b.value-a.value);
}
function toast(message,action){
  const el=$("#toast");el.innerHTML=`${esc(message)}${action?` <button id="toastAction">${esc(action.label)}</button>`:""}`;el.classList.add("show");
  if(action)$("#toastAction").onclick=()=>{action.run();el.classList.remove("show")};
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),4200);
}
function ensureMonth(key){
  if(state.months[key])return;
  const prev=state.months[monthShift(key,-1)],month=blankMonth(prev?.income||0,prev?.investment||0);
  month.budgets={...(prev?.budgets||{})};
  if(prev)prev.expenses.filter(e=>e.recurring).forEach(e=>month.expenses.push({...e,id:uid(),dueDate:dueFor(key,e.dueDate.slice(8,10)),paid:false,generated:true}));
  state.months[key]=month;persist();
}
function switchMonth(delta){
  const key=monthShift(state.selectedMonth,delta);ensureMonth(key);state.selectedMonth=key;persist();render();window.scrollTo({top:0,behavior:"smooth"});
}
function render(){
  const month=current(),t=totals(month),today=new Date().toISOString().slice(0,10),cats=byCategory(month);
  $("#monthLabel").textContent=monthName(state.selectedMonth);
  $("#expenseCount").textContent=`${month.expenses.length} lançamento${month.expenses.length===1?"":"s"}`;
  $("#summaryCards").innerHTML=`
    <article class="summarycard"><div class="cardtop"><span class="cardicon">↗</span><span class="trend">Renda</span></div><small>Renda mensal</small><strong>${money(month.income)}</strong><small>${monthName(state.selectedMonth)}</small></article>
    <article class="summarycard"><div class="cardtop"><span class="cardicon">↓</span><span class="trend">${month.expenses.length} itens</span></div><small>Despesas do mês</small><strong>${money(t.total)}</strong><small>${money(t.pending)} pendentes</small></article>
    <article class="summarycard"><div class="cardtop"><span class="cardicon">◔</span><span class="trend ${t.committed>80?"danger":""}">${t.committed.toFixed(0)}%</span></div><small>Renda comprometida</small><strong>${t.committed.toFixed(1).replace(".",",")}%</strong><div class="progress"><i style="width:${Math.min(t.committed,100)}%"></i></div></article>
    <article class="summarycard highlight"><div class="cardtop"><span class="cardicon">◆</span><button class="trend" data-action="income">Editar</button></div><small>Para investimentos</small><strong>${money(month.investment)}</strong><small>${t.investmentRate.toFixed(1).replace(".",",")}% da renda</small></article>
    <article class="summarycard"><div class="cardtop"><span class="cardicon">◈</span><span class="trend ${t.balance<0?"danger":""}">${t.balance<0?"Atenção":"Livre"}</span></div><small>Saldo livre projetado</small><strong>${money(t.balance)}</strong><small>Após despesas e investimentos</small></article>`;
  const segments=cats.length?(()=>{let start=0;return cats.map(c=>{const end=start+c.value/t.total*100,s=`${c.color} ${start}% ${end}%`;start=end;return s}).join(",")} )():"#e9e7ee 0 100%";
  $("#donut").style.background=`conic-gradient(${segments})`;$("#donutTotal").textContent=money(t.total);
  $("#categoryLegend").innerHTML=cats.length?cats.map(c=>`<div class="legendrow"><i style="background:${c.color}"></i><span>${c.name}</span><strong>${money(c.value)}</strong><small>${(c.value/t.total*100).toFixed(0)}%</small></div>`).join(""):`<div class="empty">Adicione despesas para visualizar o gráfico.</div>`;
  $("#budgetProgress").innerHTML=CATEGORIES.map(c=>{const spent=cats.find(x=>x.name===c.name)?.value||0,limit=Number(month.budgets[c.name]||0);if(!limit&&!spent)return"";const pct=limit?spent/limit*100:0,level=pct>=100?"danger":pct>=80?"warning":"";return`<div class="budgetrow"><div class="budgetmeta"><b>${c.name}</b><span>${money(spent)} de ${limit?money(limit):"sem limite"}</span></div><div class="bar"><i class="${level}" style="width:${Math.min(pct,100)}%;background:${c.color}"></i></div></div>`}).join("")||`<div class="empty">Defina limites para receber alertas por categoria.</div>`;
  const overdue=month.expenses.filter(e=>!e.paid&&e.dueDate<today&&state.selectedMonth<=nowMonth()),near=month.expenses.filter(e=>!e.paid&&e.dueDate>=today&&e.dueDate<=new Date(Date.now()+5*864e5).toISOString().slice(0,10));
  const overBudget=CATEGORIES.filter(c=>month.budgets[c.name]&&(cats.find(x=>x.name===c.name)?.value||0)>month.budgets[c.name]);
  $("#alerts").innerHTML=[
    overdue.length?`<div class="alert danger">⚠ <b>${overdue.length} conta${overdue.length>1?"s":""} vencida${overdue.length>1?"s":""}</b><span>Total de ${money(overdue.reduce((s,e)=>s+e.value,0))}</span><button onclick="setFilterValue('Vencidos')">Ver</button></div>`:"",
    overBudget.length?`<div class="alert">◔ <b>Limite ultrapassado</b><span>${overBudget.map(c=>c.name).join(", ")}</span><button data-action="budget">Ajustar</button></div>`:"",
    near.length?`<div class="alert">◷ <b>${near.length} vencimento${near.length>1?"s":""} nos próximos dias</b><span>${money(near.reduce((s,e)=>s+e.value,0))}</span></div>`:""
  ].join("");
  renderExpenses();renderCards();renderGoals();renderTrend();bindActions();renderShareStatus();applySharedPermissions();
}
function setFilterValue(value){filter=value;$("#filter").value=value;renderExpenses();$("#movimentos").scrollIntoView({behavior:"smooth"})}
function renderExpenses(){
  const today=new Date().toISOString().slice(0,10),items=current().expenses.filter(e=>{
    const match=filter==="Todos"||(filter==="Pagos"&&e.paid)||(filter==="Pendentes"&&!e.paid)||(filter==="Vencidos"&&!e.paid&&e.dueDate<today)||e.category===filter;
    return match&&e.description.toLowerCase().includes(query.toLowerCase());
  }).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  $("#expenseTable").innerHTML=`<div class="tablerow tablelabels"><span>DESPESA</span><span>CATEGORIA</span><span>VENCIMENTO</span><span>STATUS</span><span>VALOR</span><span></span></div>`+(items.length?items.map(e=>{const c=category(e.category),card=state.cards.find(x=>x.id===e.cardId);return`<div class="tablerow"><span class="expensename"><i style="color:${c.color};background:${c.color}18">${c.icon}</i><span><b>${esc(e.description)}</b>${e.totalInstallments>1?`<small>${e.installment}/${e.totalInstallments}</small>`:""}${card?`<small> • ${esc(card.name)}</small>`:""}</span></span><span>${esc(e.category)}</span><span>${e.dueDate.split("-").reverse().join("/")}</span><button class="status ${e.paid?"paid":"pending"}" data-toggle="${e.id}">${e.paid?"Pago":"Pendente"}</button><strong>${money(e.value)}</strong><span class="rowactions"><button data-edit="${e.id}" aria-label="Editar">✎</button><button data-delete="${e.id}" aria-label="Excluir">×</button></span></div>`}).join(""):`<div class="empty">Nenhuma despesa encontrada neste período.</div>`);
  document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>{const e=current().expenses.find(x=>x.id===b.dataset.toggle);e.paid=!e.paid;persist();render()});
  document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openModal("expense",b.dataset.edit));
  document.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{const index=current().expenses.findIndex(x=>x.id===b.dataset.delete);deletedUndo={month:state.selectedMonth,item:current().expenses[index],index};current().expenses.splice(index,1);persist();render();toast("Despesa excluída.",{label:"Desfazer",run:()=>{const m=state.months[deletedUndo.month];m.expenses.splice(deletedUndo.index,0,deletedUndo.item);persist();render()}})});
}
function renderCards(){
  $("#cardsList").innerHTML=state.cards.length?state.cards.map(card=>{const spent=current().expenses.filter(e=>e.cardId===card.id).reduce((s,e)=>s+e.value,0),pct=card.limit?Math.min(spent/card.limit*100,100):0;return`<div class="creditcard" style="background:linear-gradient(135deg,${card.color},#1d1930)"><header><b>${esc(card.name)}</b><small>fecha dia ${card.closing}</small></header><strong>${money(spent)}</strong><small>de ${money(card.limit)} • vence dia ${card.due}</small><div class="cardbar"><i style="width:${pct}%"></i></div><button data-card-edit="${card.id}">Editar</button></div>`}).join(""):`<div class="empty">Cadastre cartões para acompanhar limites e compras parceladas.</div>`;
  document.querySelectorAll("[data-card-edit]").forEach(b=>b.onclick=()=>openModal("card",b.dataset.cardEdit));
}
function renderGoals(){
  $("#goalsList").innerHTML=state.goals.length?state.goals.map(g=>{const pct=g.target?Math.min(g.saved/g.target*100,100):0;return`<div class="goal"><div class="goalhead"><strong>${esc(g.name)}</strong><button data-contribute="${g.id}">＋ Aportar</button></div><p><span>${money(g.saved)} acumulados</span><b>${pct.toFixed(0)}%</b></p><div class="bar"><i style="width:${pct}%;background:${g.color}"></i></div><p><span>Meta ${money(g.target)}</span><span>${g.deadline?new Date(g.deadline+"T12:00:00").toLocaleDateString("pt-BR"):"Sem prazo"}</span></p></div>`}).join(""):`<div class="empty">Crie uma reserva de emergência, viagem ou outro objetivo.</div>`;
  document.querySelectorAll("[data-contribute]").forEach(b=>b.onclick=()=>openModal("contribution",b.dataset.contribute));
}
function renderTrend(){
  const months=Array.from({length:6},(_,i)=>monthShift(state.selectedMonth,i-5)),values=months.map(k=>({key:k,total:state.months[k]?totals(state.months[k]).total:0})),max=Math.max(...values.map(v=>v.total),1);
  $("#trendChart").innerHTML=values.map(v=>`<div class="trendcol"><strong>${money(v.total)}</strong><div class="trendbar" style="height:${Math.max(v.total/max*125,3)}px"></div><small>${monthName(v.key).split(" ")[0].slice(0,3)}</small></div>`).join("");
}
function bindActions(){document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>openModal(b.dataset.action))}
function openModal(type,id=null){
  editing={type,id};const month=current(),content=$("#modalContent"),expense=id&&month.expenses.find(e=>e.id===id),card=id&&state.cards.find(c=>c.id===id),goal=id&&state.goals.find(g=>g.id===id);
  if(type==="income")content.innerHTML=`<form id="modalForm"><span class="eyebrow">PLANEJAMENTO DO MÊS</span><h2>Renda e investimentos</h2><p>Informe os valores disponíveis em ${monthName(state.selectedMonth)}.</p><div class="formgrid"><label>Renda mensal (R$)<input name="income" type="number" min="0" step=".01" value="${month.income}" required></label><label>Destinar a investimentos (R$)<input name="investment" type="number" min="0" step=".01" value="${month.investment}" required></label></div><button class="primary">Salvar planejamento</button></form>`;
  if(type==="budget")content.innerHTML=`<form id="modalForm"><span class="eyebrow">LIMITES POR CATEGORIA</span><h2>Orçamento mensal</h2><p>Deixe em zero as categorias que não precisam de limite.</p><div class="formgrid">${CATEGORIES.map(c=>`<label>${c.name} (R$)<input name="budget_${c.name}" type="number" min="0" step=".01" value="${month.budgets[c.name]||0}"></label>`).join("")}</div><button class="primary">Salvar limites</button></form>`;
  if(type==="expense")content.innerHTML=`<form id="modalForm"><span class="eyebrow">${expense?"EDITAR":"NOVO"} LANÇAMENTO</span><h2>${expense?"Editar":"Adicionar"} despesa</h2><div class="formgrid"><label class="wide">Descrição<input name="description" value="${esc(expense?.description||"")}" required autofocus></label><label>Valor (R$)<input name="value" type="number" min=".01" step=".01" value="${expense?.value||""}" required></label><label>Vencimento<input name="dueDate" type="date" value="${expense?.dueDate||dueFor(state.selectedMonth,new Date().getDate())}" required></label><label>Categoria<select name="category">${CATEGORIES.map(c=>`<option ${expense?.category===c.name?"selected":""}>${c.name}</option>`).join("")}</select></label><label>Pagamento<select name="payment">${["Pix","Crédito","Débito","Boleto","Dinheiro"].map(p=>`<option ${expense?.payment===p?"selected":""}>${p}</option>`).join("")}</select></label><label>Cartão<select name="cardId"><option value="">Nenhum</option>${state.cards.map(c=>`<option value="${c.id}" ${expense?.cardId===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label><label>Parcelas<input name="installments" type="number" min="1" max="60" value="${expense?.totalInstallments||1}" ${expense?"disabled":""}></label></div><div class="checks"><label><input name="paid" type="checkbox" ${expense?.paid?"checked":""}> Já foi paga</label><label><input name="recurring" type="checkbox" ${expense?.recurring?"checked":""}> Repete todo mês</label></div><button class="primary">${expense?"Salvar alterações":"Adicionar despesa"}</button></form>`;
  if(type==="card")content.innerHTML=`<form id="modalForm"><span class="eyebrow">CARTÃO DE CRÉDITO</span><h2>${card?"Editar":"Cadastrar"} cartão</h2><div class="formgrid"><label class="wide">Nome do cartão<input name="name" value="${esc(card?.name||"")}" placeholder="Ex.: Nubank" required></label><label>Limite (R$)<input name="limit" type="number" min="0" step=".01" value="${card?.limit||""}" required></label><label>Fechamento<input name="closing" type="number" min="1" max="31" value="${card?.closing||10}" required></label><label>Vencimento<input name="due" type="number" min="1" max="31" value="${card?.due||17}" required></label><label>Cor<select name="color">${["#7957ff","#c74362","#177e73","#324f91","#171329"].map(c=>`<option value="${c}" ${card?.color===c?"selected":""} style="color:${c}">${c}</option>`).join("")}</select></label></div><button class="primary">Salvar cartão</button>${card?`<button type="button" class="dangerbtn" id="removeCard">Excluir cartão</button>`:""}</form>`;
  if(type==="goal")content.innerHTML=`<form id="modalForm"><span class="eyebrow">NOVO OBJETIVO</span><h2>Criar meta financeira</h2><div class="formgrid"><label class="wide">Nome da meta<input name="name" placeholder="Ex.: Reserva de emergência" required></label><label>Valor desejado (R$)<input name="target" type="number" min=".01" step=".01" required></label><label>Já acumulado (R$)<input name="saved" type="number" min="0" step=".01" value="0"></label><label>Prazo<input name="deadline" type="date"></label><label>Cor<select name="color"><option value="#7957ff">Roxo</option><option value="#0aa78f">Verde</option><option value="#d89d15">Dourado</option><option value="#e94d6b">Rosa</option></select></label></div><button class="primary">Criar meta</button></form>`;
  if(type==="contribution")content.innerHTML=`<form id="modalForm"><span class="eyebrow">APORTE</span><h2>${esc(goal.name)}</h2><p>Acumulado atual: ${money(goal.saved)} de ${money(goal.target)}.</p><label>Valor do aporte (R$)<input name="amount" type="number" min=".01" step=".01" required autofocus></label><button class="primary">Registrar aporte</button></form>`;
  $("#modalBack").classList.add("show");$("#modalForm").onsubmit=saveModal;
  if(card&&$("#removeCard"))$("#removeCard").onclick=()=>{if(confirm("Excluir este cartão? As despesas serão mantidas sem vínculo.")){state.cards=state.cards.filter(c=>c.id!==card.id);Object.values(state.months).forEach(m=>m.expenses.forEach(e=>{if(e.cardId===card.id)e.cardId=""}));persist();closeModal();render()}};
}
function closeModal(){$("#modalBack").classList.remove("show");editing=null}
function saveModal(event){
  event.preventDefault();const data=new FormData(event.currentTarget),month=current(),{type,id}=editing;
  if(type==="income"){month.income=Number(data.get("income"));month.investment=Number(data.get("investment"))}
  if(type==="budget")CATEGORIES.forEach(c=>month.budgets[c.name]=Number(data.get(`budget_${c.name}`))||0);
  if(type==="expense"){
    const base={description:String(data.get("description")).trim(),value:Number(data.get("value")),dueDate:String(data.get("dueDate")),category:String(data.get("category")),payment:String(data.get("payment")),cardId:String(data.get("cardId")||""),paid:data.get("paid")==="on",recurring:data.get("recurring")==="on"};
    if(id)Object.assign(month.expenses.find(e=>e.id===id),base);
    else{
      const count=Math.max(Number(data.get("installments"))||1,1),seriesId=count>1||base.recurring?uid():null;
      for(let i=0;i<count;i++){const key=monthShift(state.selectedMonth,i);ensureMonth(key);state.months[key].expenses.unshift({...base,id:uid(),seriesId,installment:i+1,totalInstallments:count,dueDate:dueFor(key,base.dueDate.slice(8,10)),paid:i===0&&base.paid,recurring:count===1&&base.recurring})}
    }
  }
  if(type==="card"){
    const value={name:String(data.get("name")),limit:Number(data.get("limit")),closing:Number(data.get("closing")),due:Number(data.get("due")),color:String(data.get("color"))};
    if(id)Object.assign(state.cards.find(c=>c.id===id),value);else state.cards.push({id:uid(),...value});
  }
  if(type==="goal")state.goals.push({id:uid(),name:String(data.get("name")),target:Number(data.get("target")),saved:Number(data.get("saved"))||0,deadline:String(data.get("deadline")),color:String(data.get("color"))});
  if(type==="contribution"){const goal=state.goals.find(g=>g.id===id);goal.saved=Math.min(goal.target,goal.saved+Number(data.get("amount")))}
  persist();closeModal();render();toast("Informações salvas com sucesso.");
}
function spokenAmount(text){
  const values={zero:0,um:1,uma:1,dois:2,duas:2,três:3,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90,cem:100,cento:100,duzentos:200,trezentos:300,quatrocentos:400,quinhentos:500,seiscentos:600,setecentos:700,oitocentos:800,novecentos:900,mil:1000};
  let amount=0,active=false;
  for(const raw of text.toLowerCase().replace(/[.,!?]/g," ").split(/\s+/)){
    const word=raw.normalize("NFD").replace(/[\u0300-\u036f]/g,""),value=values[word];
    if(value!==undefined){active=true;amount=value===1000?(amount||1)*1000:amount+value;continue}
    if(active&&(word==="e"||word==="reais"||word==="real")){if(word!=="e")break;continue}
    if(active)break;
  }
  return active?amount:null;
}
function parseExpense(text){
  const normalized=text.toLowerCase(),numbers=[...normalized.matchAll(/(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/g)].map(m=>({raw:m[0],value:Number(m[1].replace(",",".")),index:m.index}));
  const value=numbers.find(n=>n.value>0)?.value??spokenAmount(normalized);if(!value)return null;
  const rules=[
    ["Alimentação",/mercado|supermercado|restaurante|lanche|almoço|jantar|comida|ifood/],
    ["Transporte",/combustível|gasolina|uber|ônibus|transporte|estacionamento/],["Moradia",/aluguel|energia|água|condomínio|casa/],
    ["Saúde",/farmácia|remédio|médico|saúde|consulta/],["Educação",/curso|livro|escola|faculdade/],
    ["Assinaturas",/netflix|spotify|internet|assinatura|streaming/],["Lazer",/cinema|viagem|lazer|show/]
  ];
  const cat=rules.find(([,r])=>r.test(normalized))?.[0]||"Outros";
  const date=normalized.includes("amanhã")?new Date(Date.now()+864e5):new Date(),due=dueFor(state.selectedMonth,date.getDate());
  const numberWords="zero|um|uma|dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil";
  let description=text.replace(numbers[0]?.raw||"","").replace(new RegExp(`\\b(gastei|paguei|comprei|reais|real|hoje|amanhã|no|na|em|de|e|${numberWords})\\b`,"gi")," ").replace(/\s+/g," ").trim();
  description=description?description[0].toUpperCase()+description.slice(1):cat;
  return{description,value,category:cat,dueDate:due,payment:/cartão|crédito/.test(normalized)?"Crédito":/pix/.test(normalized)?"Pix":"Outros"};
}
function quickAdd(text){
  const parsed=parseExpense(text);if(!parsed){toast("Não identifiquei o valor. Tente: “Gastei 85 no supermercado hoje”.");return false}
  current().expenses.unshift({...parsed,id:uid(),paid:false,recurring:false,cardId:"",installment:1,totalInstallments:1,seriesId:null});persist();render();toast(`${parsed.description} adicionada: ${money(parsed.value)}.`);return true;
}
function startVoiceExpense(){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){toast("O reconhecimento de voz não está disponível neste navegador. No Android, use o Chrome atualizado.");return}
  const button=$("#voiceAdd"),recognition=new SpeechRecognition();
  recognition.lang="pt-BR";recognition.interimResults=false;recognition.maxAlternatives=1;
  button.disabled=true;button.classList.add("listening");button.textContent="● Ouvindo...";
  recognition.onresult=event=>{const transcript=event.results[0][0].transcript.trim();$("#quickInput").value=transcript;setTimeout(()=>quickAdd(transcript),150)};
  recognition.onerror=event=>toast(event.error==="not-allowed"?"Permita o uso do microfone para falar a despesa.":event.error==="no-speech"?"Não consegui ouvir. Toque no microfone e tente novamente.":"Não foi possível reconhecer a fala.");
  recognition.onend=()=>{button.disabled=false;button.classList.remove("listening");button.textContent="🎤 Falar despesa"};
  try{recognition.start()}catch{recognition.onend();toast("O microfone já está sendo utilizado.")}
}
function assistantAnswer(prompt){
  const p=prompt.toLowerCase(),month=current(),t=totals(),cats=byCategory(),top=cats[0],over=CATEGORIES.filter(c=>month.budgets[c.name]&&(cats.find(x=>x.name===c.name)?.value||0)>month.budgets[c.name]),months=Object.keys(state.months).sort(),previous=state.months[monthShift(state.selectedMonth,-1)],pt=previous?totals(previous):null;
  if(/gastei|paguei|comprei/.test(p)){const parsed=parseExpense(prompt);return parsed?`Entendi ${money(parsed.value)} em ${parsed.category}. Use “Adicionar com IA” acima das despesas para confirmar esse lançamento automaticamente.`:"Não consegui identificar um valor. Exemplo: “Gastei 85 no supermercado hoje”."}
  if(/meta|objetivo|reserva/.test(p)){if(!state.goals.length)return"Você ainda não criou metas. Comece por uma reserva de emergência equivalente a alguns meses das suas despesas essenciais.";const closest=[...state.goals].sort((a,b)=>b.saved/b.target-a.saved/a.target)[0];return`Você possui ${state.goals.length} meta(s). “${closest.name}” está em ${(closest.saved/closest.target*100).toFixed(0)}%, com ${money(closest.target-closest.saved)} restantes.`}
  if(/econom|reduzir|cortar/.test(p))return top?`${top.name} é sua maior categoria, com ${money(top.value)}. Uma redução gradual de 10% liberaria ${money(top.value*.1)}. ${over.length?`Atenção especial a ${over.map(c=>c.name).join(", ")}, acima do limite.`:"Seus limites cadastrados ainda não foram ultrapassados."}`:"Cadastre despesas para eu identificar oportunidades.";
  if(/cart|fatura|limite/.test(p)){if(!state.cards.length)return"Você ainda não cadastrou cartões. Ao cadastrar, consigo acompanhar limite e compras parceladas.";const risky=state.cards.map(c=>({c,used:month.expenses.filter(e=>e.cardId===c.id).reduce((s,e)=>s+e.value,0)})).sort((a,b)=>b.used/b.c.limit-a.used/a.c.limit)[0];return`O cartão ${risky.c.name} utiliza ${money(risky.used)} de ${money(risky.c.limit)} (${(risky.used/risky.c.limit*100||0).toFixed(0)}%).`}
  if(/invest|aplicar/.test(p))return`Você reservou ${money(month.investment)} (${t.investmentRate.toFixed(1).replace(".",",")}% da renda). Depois de despesas e investimentos, o saldo projetado é ${money(t.balance)}.`;
  if(/compar|anterior|evolu/.test(p))return pt?`As despesas ${t.total>pt.total?"aumentaram":"diminuíram"} ${money(Math.abs(t.total-pt.total))} em relação ao mês anterior (${money(pt.total)}).`:"Ainda não há dados no mês anterior para comparar.";
  const health=t.balance<0?"crítico, pois o saldo projetado está negativo":t.committed>80?"apertado, com mais de 80% da renda comprometida":t.committed>60?"sob atenção, mas ainda com margem":"equilibrado";
  return`Seu mês está ${health}. As despesas somam ${money(t.total)} (${t.committed.toFixed(1).replace(".",",")}% da renda), há ${money(t.pending)} pendentes e o saldo livre projetado é ${money(t.balance)}.${top?` A maior categoria é ${top.name}.`:""}`;
}
function sendAssistant(prompt){
  if(!prompt.trim())return;const chat=$("#aiChat");chat.insertAdjacentHTML("beforeend",`<div class="usermsg">${esc(prompt)}</div><div class="aimsg">${esc(assistantAnswer(prompt))}</div>`);chat.scrollTop=chat.scrollHeight;
}
function download(name,type,content){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function exportBackup(){download(`Despesas_Pessoais_Backup_${new Date().toISOString().slice(0,10)}.json`,"application/json",JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2));toast("Backup completo gerado. Guarde o arquivo em local seguro.")}
function restoreBackup(file){const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result);if(data.version!==2||!data.months)throw Error();state=data;persist();render();toast("Backup restaurado com sucesso.")}catch{toast("Este arquivo não é um backup válido.")}};reader.readAsText(file)}
function exportExcel(){
  if(!window.XLSX){toast("Conecte-se à internet para gerar o Excel.");return}const month=current(),t=totals(),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{Indicador:"Mês",Valor:monthName(state.selectedMonth)},{Indicador:"Renda",Valor:month.income},{Indicador:"Despesas",Valor:t.total},{Indicador:"Investimentos",Valor:month.investment},{Indicador:"Saldo livre",Valor:t.balance}]),"Resumo");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(month.expenses.map(e=>({Descrição:e.description,Categoria:e.category,Valor:e.value,Vencimento:e.dueDate,Situação:e.paid?"Pago":"Pendente",Pagamento:e.payment,Parcela:e.totalInstallments>1?`${e.installment}/${e.totalInstallments}`:"",Recorrente:e.recurring?"Sim":"Não",Cartão:state.cards.find(c=>c.id===e.cardId)?.name||""}))),"Despesas");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(state.goals.map(g=>({Meta:g.name,Objetivo:g.target,Acumulado:g.saved,Progresso:g.saved/g.target,Prazo:g.deadline}))),"Metas");
  XLSX.writeFile(wb,`Despesas_Pessoais_${state.selectedMonth}.xlsx`);toast("Planilha Excel gerada.");
}
function reportDonut(cats,total){if(!total)return`<p>Sem despesas neste mês.</p>`;const r=55,circ=2*Math.PI*r;let offset=0;return`<div class="donutReport"><svg viewBox="0 0 150 150">${cats.map(c=>{const len=c.value/total*circ,start=offset;offset+=len;return`<circle cx="75" cy="75" r="${r}" fill="none" stroke="${c.color}" stroke-width="24" stroke-dasharray="${len} ${circ-len}" stroke-dashoffset="${-start}" transform="rotate(-90 75 75)"/>`}).join("")}<text x="75" y="72" text-anchor="middle">Total</text><text x="75" y="91" text-anchor="middle" font-weight="bold">${money(total)}</text></svg><div>${cats.map(c=>`<p><i style="background:${c.color}"></i>${c.name}<b>${(c.value/total*100).toFixed(1)}%</b></p>`).join("")}</div></div>`}
function exportPdf(){
  const month=current(),t=totals(),cats=byCategory(),max=Math.max(...cats.map(c=>c.value),1),w=open("","_blank");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Relatório Despesas Pessoais</title><style>*{box-sizing:border-box}body{font:12px Arial;color:#1d1930;margin:0;padding:25px;-webkit-print-color-adjust:exact;print-color-adjust:exact}header{background:#1d1930;color:#fff;padding:22px;border-radius:12px}header h1{margin:0}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:15px 0}.summary div,.chart{border:1px solid #e5e1ec;border-radius:10px;padding:12px}.summary small{display:block;color:#777}.charts{display:grid;grid-template-columns:1fr 1fr;gap:10px}.donutReport{display:flex;align-items:center}.donutReport svg{width:155px;height:155px}.donutReport p{display:grid;grid-template-columns:10px 1fr auto;gap:6px;margin:6px}.donutReport i{width:8px;height:8px;border-radius:50%}.bars p{display:grid;grid-template-columns:80px 1fr 65px;gap:7px;align-items:center}.track{height:9px;background:#eeeaf4;border-radius:8px;overflow:hidden}.track i{display:block;height:100%}.stack{display:flex;height:20px;border-radius:6px;overflow:hidden;background:#eee}.stack i{display:block}table{width:100%;border-collapse:collapse;margin-top:15px;font-size:9px}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:left}th{background:#1d1930;color:#fff}@page{size:A4;margin:9mm}@media print{button{display:none}}</style></head><body><header><h1>Despesas Pessoais</h1><p>${monthName(state.selectedMonth)} • Gerado em ${new Date().toLocaleDateString("pt-BR")}</p></header><section class="summary"><div><small>Renda</small><b>${money(month.income)}</b></div><div><small>Despesas</small><b>${money(t.total)}</b></div><div><small>Investimentos</small><b>${money(month.investment)}</b></div><div><small>Saldo livre</small><b>${money(t.balance)}</b></div></section><section class="charts"><article class="chart"><h3>Distribuição por categoria</h3>${reportDonut(cats,t.total)}</article><article class="chart bars"><h3>Comparativo de gastos</h3>${cats.map(c=>`<p><span>${c.name}</span><span class="track"><i style="width:${c.value/max*100}%;background:${c.color}"></i></span><b>${money(c.value)}</b></p>`).join("")||"<p>Sem despesas</p>"}</article></section><article class="chart" style="margin-top:10px"><h3>Composição da renda</h3><div class="stack"><i style="width:${Math.min(t.total/(month.income||1)*100,100)}%;background:#7957ff"></i><i style="width:${Math.min(month.investment/(month.income||1)*100,100)}%;background:#d89d15"></i><i style="flex:1;background:#0aa78f"></i></div><p>Despesas ${money(t.total)} • Investimentos ${money(month.investment)} • Livre ${money(t.balance)}</p></article><table><thead><tr><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead><tbody>${month.expenses.map(e=>`<tr><td>${esc(e.description)}</td><td>${e.category}</td><td>${money(e.value)}</td><td>${e.dueDate.split("-").reverse().join("/")}</td><td>${e.paid?"Pago":"Pendente"}</td></tr>`).join("")||`<tr><td colspan="5">Sem despesas</td></tr>`}</tbody></table><button onclick="print()">Salvar como PDF</button><script>setTimeout(()=>print(),500)<\/script></body></html>`);w.document.close();
}
function cloudConfigured(){
  const config=window.DESPS_SUPABASE||{};
  return Boolean(config.url&&config.anonKey&&window.supabase?.createClient);
}
function renderShareStatus(){
  const label=$("#shareStatus");if(!label)return;
  label.textContent=cloud.active?.name||"Pessoal";
  $("#shareBtn").classList.toggle("connected",Boolean(cloud.active));
}
function applySharedPermissions(){
  const viewer=cloud.active&&cloud.role==="viewer";
  document.body.classList.toggle("sharedviewer",Boolean(viewer));
  if(!viewer)return;
  document.querySelectorAll("[data-action],[data-toggle],[data-edit],[data-delete],[data-card-edit],[data-contribute],#quickAdd,#voiceAdd").forEach(button=>button.disabled=true);
}
function queueCloudSave(){
  if(!cloud.client||!cloud.active||cloud.role==="viewer")return;
  clearTimeout(cloud.saveTimer);
  cloud.saveTimer=setTimeout(saveSharedState,650);
}
async function saveSharedState(){
  if(!cloud.client||!cloud.active||cloud.role==="viewer"||cloud.applying)return;
  const nextRevision=cloud.revision+1;
  const {error}=await cloud.client.from("household_snapshots").upsert({
    household_id:cloud.active.id,data:state,revision:nextRevision,
    updated_by:cloud.user.id,updated_at:new Date().toISOString()
  },{onConflict:"household_id"});
  if(error){toast("Não foi possível sincronizar agora. Seus dados continuam salvos neste aparelho.");return}
  cloud.revision=nextRevision;renderShareStatus();
}
async function loadHouseholds(){
  if(!cloud.client||!cloud.user)return;
  const {data,error}=await cloud.client.from("household_members").select("household_id,role,households(id,name,owner_id)").eq("user_id",cloud.user.id);
  if(error){cloud.households=[];return}
  cloud.households=(data||[]).map(item=>({...item.households,role:item.role})).filter(item=>item.id);
}
async function activateHousehold(id,{keepPersonal=true}={}){
  const household=cloud.households.find(item=>item.id===id);if(!household)return;
  if(keepPersonal&&!cloud.active)localStorage.setItem(PERSONAL_STORE,JSON.stringify(state));
  if(cloud.channel)await cloud.client.removeChannel(cloud.channel);
  cloud.active=household;cloud.role=household.role;localStorage.setItem(ACTIVE_HOUSEHOLD,id);
  const {data,error}=await cloud.client.from("household_snapshots").select("data,revision,updated_by,updated_at").eq("household_id",id).maybeSingle();
  if(error){toast("Não foi possível abrir o orçamento compartilhado.");return}
  if(data?.data?.version===2){
    cloud.applying=true;state=data.data;localStorage.setItem(STORE,JSON.stringify(state));cloud.applying=false;
    cloud.revision=Number(data.revision)||0;cloud.lastEditor=data.updated_by;cloud.lastUpdate=data.updated_at;
  }else if(cloud.role!=="viewer"){
    cloud.revision=0;await saveSharedState();
  }
  cloud.channel=cloud.client.channel(`household:${id}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"household_snapshots",filter:`household_id=eq.${id}`},payload=>{
      const row=payload.new;if(!row?.data||row.updated_by===cloud.user?.id||Number(row.revision)<=cloud.revision)return;
      cloud.applying=true;state=row.data;cloud.revision=Number(row.revision)||cloud.revision;cloud.lastEditor=row.updated_by;cloud.lastUpdate=row.updated_at;
      localStorage.setItem(STORE,JSON.stringify(state));cloud.applying=false;render();toast("Orçamento atualizado por outro participante.");
    }).subscribe();
  render();closeModal();toast(`Orçamento “${household.name}” conectado em tempo real.`);
}
async function usePersonalMode(){
  if(cloud.channel)await cloud.client.removeChannel(cloud.channel);
  cloud.channel=null;cloud.active=null;cloud.role=null;cloud.revision=0;localStorage.removeItem(ACTIVE_HOUSEHOLD);
  try{const personal=JSON.parse(localStorage.getItem(PERSONAL_STORE)||"null");if(personal?.version===2)state=personal}catch{}
  localStorage.setItem(STORE,JSON.stringify(state));render();closeModal();toast("Modo pessoal ativado.");
}
async function createHousehold(name){
  const {data,error}=await cloud.client.from("households").insert({name,owner_id:cloud.user.id}).select().single();
  if(error){toast("Não foi possível criar o espaço compartilhado.");return}
  await loadHouseholds();await activateHousehold(data.id);
}
async function createInvite(role){
  if(!cloud.active)return;
  const {data,error}=await cloud.client.from("household_invites").insert({
    household_id:cloud.active.id,role,created_by:cloud.user.id
  }).select("token").single();
  if(error){toast("Somente o proprietário pode criar convites.");return}
  const url=new URL(location.href);url.search="";url.hash="";url.searchParams.set("invite",data.token);
  try{await navigator.clipboard.writeText(url.href);toast("Convite copiado. Envie o link para a outra pessoa.");}
  catch{prompt("Copie e envie este convite:",url.href)}
}
async function acceptPendingInvite(){
  const token=new URL(location.href).searchParams.get("invite");if(!token||!cloud.user)return;
  const {data,error}=await cloud.client.rpc("accept_household_invite",{invite_token:token});
  if(error){toast("Este convite é inválido ou expirou.");return}
  history.replaceState({},document.title,location.pathname);
  await loadHouseholds();await activateHousehold(data);
}
function sharingContent(){
  if(!cloudConfigured())return`<span class="eyebrow">COMPARTILHAMENTO</span><h2>Sincronização em configuração</h2><p>O modo pessoal continua disponível e seguro neste aparelho. Para ativar contas e compartilhamento, o administrador precisa conectar o aplicativo ao serviço de sincronização.</p><div class="privacybox"><b>Nenhum dado foi enviado.</b><span>Até a configuração ser concluída, suas informações permanecem somente neste dispositivo.</span></div>`;
  if(!cloud.user)return`<form id="shareLogin"><span class="eyebrow">COMPARTILHAMENTO SEGURO</span><h2>Entrar para compartilhar</h2><p>Use seu e-mail para receber um link de acesso. Não é necessário criar senha.</p><label>E-mail<input name="email" type="email" autocomplete="email" required placeholder="voce@exemplo.com"></label><button class="primary">Enviar link de acesso</button><div class="privacybox"><b>Seus dados pessoais continuam privados.</b><span>Somente um espaço criado ou aceito por você será sincronizado.</span></div></form>`;
  const spaces=cloud.households.map(h=>`<button type="button" class="spaceitem ${cloud.active?.id===h.id?"active":""}" data-space="${h.id}"><span><b>${esc(h.name)}</b><small>${h.role==="owner"?"Proprietário":h.role==="editor"?"Pode editar":"Somente leitura"}</small></span><strong>${cloud.active?.id===h.id?"Conectado":"Abrir"}</strong></button>`).join("");
  return`<span class="eyebrow">TEMPO REAL</span><h2>Compartilhar orçamento</h2><p class="accountline">${esc(cloud.user.email)}</p>
    ${cloud.active?`<div class="connectedbox"><span class="livepulse"></span><span><b>${esc(cloud.active.name)}</b><small>Sincronização ativa${cloud.lastUpdate?` • atualizada ${new Date(cloud.lastUpdate).toLocaleString("pt-BR")}`:""}</small></span></div>`:""}
    <div class="spacelist">${spaces||`<div class="empty">Você ainda não participa de nenhum orçamento.</div>`}</div>
    <form id="newHousehold" class="inlineform"><input name="name" maxlength="80" placeholder="Ex.: Orçamento da família" required><button class="primary">Criar espaço</button></form>
    ${cloud.active&&cloud.role==="owner"?`<div class="invitebox"><b>Convidar participante</b><p>O convite vale por 7 dias. Escolha o acesso e envie o link gerado.</p><div><button id="inviteEditor" class="secondary">Pode editar</button><button id="inviteViewer" class="secondary">Somente visualizar</button></div></div>`:""}
    <div class="sharefooter">${cloud.active?`<button id="personalMode" class="secondary">Voltar ao modo pessoal</button>`:""}<button id="signOut" class="textbtn">Sair da conta</button></div>`;
}
function bindSharingModal(){
  $("#shareLogin")?.addEventListener("submit",async event=>{
    event.preventDefault();const email=new FormData(event.currentTarget).get("email");
    const {error}=await cloud.client.auth.signInWithOtp({email,options:{emailRedirectTo:location.href}});
    toast(error?"Não foi possível enviar o acesso.":"Enviamos um link de acesso para seu e-mail.");if(!error)closeModal();
  });
  $("#newHousehold")?.addEventListener("submit",event=>{event.preventDefault();createHousehold(String(new FormData(event.currentTarget).get("name")).trim())});
  document.querySelectorAll("[data-space]").forEach(button=>button.onclick=()=>activateHousehold(button.dataset.space));
  if($("#inviteEditor"))$("#inviteEditor").onclick=()=>createInvite("editor");
  if($("#inviteViewer"))$("#inviteViewer").onclick=()=>createInvite("viewer");
  if($("#personalMode"))$("#personalMode").onclick=usePersonalMode;
  if($("#signOut"))$("#signOut").onclick=async()=>{await usePersonalMode();await cloud.client.auth.signOut();cloud.user=null;cloud.households=[];toast("Conta desconectada.")};
}
function openSharing(){
  $("#modalContent").innerHTML=sharingContent();$("#modalBack").classList.add("show");bindSharingModal();
}
async function initSharing(){
  if(!cloudConfigured()){renderShareStatus();return}
  const config=window.DESPS_SUPABASE;cloud.client=window.supabase.createClient(config.url,config.anonKey);
  const {data}=await cloud.client.auth.getSession();cloud.user=data.session?.user||null;
  cloud.client.auth.onAuthStateChange(async(_event,session)=>{
    cloud.user=session?.user||null;
    if(cloud.user){await loadHouseholds();await acceptPendingInvite();renderShareStatus();}
  });
  if(!cloud.user)return;
  await loadHouseholds();
  if(new URL(location.href).searchParams.get("invite")){await acceptPendingInvite();return}
  const saved=localStorage.getItem(ACTIVE_HOUSEHOLD);
  if(saved&&cloud.households.some(item=>item.id===saved))await activateHousehold(saved,{keepPersonal:false});
}
async function enableNotifications(){
  if(!("Notification"in window)){toast("Este navegador não oferece notificações.");return}
  const result=await Notification.requestPermission();state.settings.notifications=result==="granted";persist();toast(result==="granted"?"Alertas autorizados.":"Notificações não foram autorizadas.");
}
function notifyDue(){
  if(!state.settings.notifications||Notification.permission!=="granted")return;const today=new Date().toISOString().slice(0,10),limit=new Date(Date.now()+2*864e5).toISOString().slice(0,10),items=current().expenses.filter(e=>!e.paid&&e.dueDate>=today&&e.dueDate<=limit);
  if(items.length)new Notification("Despesas Pessoais",{body:`${items.length} conta(s) vencem nos próximos dois dias.`,icon:"./icon.svg"});
}
$("#prevMonth").onclick=()=>switchMonth(-1);$("#nextMonth").onclick=()=>switchMonth(1);$("#currentMonth").onclick=()=>{ensureMonth(nowMonth());state.selectedMonth=nowMonth();persist();render()};
$("#themeBtn").onclick=()=>{document.body.classList.toggle("dark");localStorage.setItem("despesas-pessoais-theme",document.body.classList.contains("dark")?"dark":"light")};
$("#shareBtn").onclick=openSharing;
$("#monthPick").onclick=()=>{const value=prompt("Digite o mês no formato AAAA-MM:",state.selectedMonth);if(/^\\d{4}-(0[1-9]|1[0-2])$/.test(value||"")){ensureMonth(value);state.selectedMonth=value;persist();render()}};
$("#search").oninput=e=>{query=e.target.value;renderExpenses()};$("#filter").onchange=e=>{filter=e.target.value;renderExpenses()};
$("#modalClose").onclick=closeModal;$("#modalBack").onclick=e=>{if(e.target.id==="modalBack")closeModal()};
$("#quickAdd").onclick=()=>{if(quickAdd($("#quickInput").value))$("#quickInput").value=""};$("#voiceAdd").onclick=startVoiceExpense;$("#quickInput").onkeydown=e=>{if(e.key==="Enter")$("#quickAdd").click()};
$("#aiSend").onclick=()=>{sendAssistant($("#aiInput").value);$("#aiInput").value=""};$("#aiInput").onkeydown=e=>{if(e.key==="Enter")$("#aiSend").click()};document.querySelectorAll("[data-prompt]").forEach(b=>b.onclick=()=>sendAssistant(b.dataset.prompt));
$("#excelBtn").onclick=exportExcel;$("#pdfBtn").onclick=exportPdf;$("#backupBtn").onclick=exportBackup;$("#restoreBtn").onclick=()=>$("#restoreFile").click();$("#restoreFile").onchange=e=>e.target.files[0]&&restoreBackup(e.target.files[0]);$("#notifyBtn").onclick=enableNotifications;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e});window.addEventListener("appinstalled",()=>$("#installBtn").hidden=true);
$("#installBtn").onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null}else toast(/iPhone|iPad/.test(navigator.userAgent)?"No Safari, use Compartilhar → Adicionar à Tela de Início.":"No menu do navegador, escolha Instalar aplicativo.")};
if(matchMedia("(display-mode: standalone)").matches||navigator.standalone)$("#installBtn").hidden=true;
if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js");
window.setFilterValue=setFilterValue;render();notifyDue();initSharing();
