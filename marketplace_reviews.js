// Marketplace Reviews Widget - inject into 09_marketplace.html product cards
// Adds star rating, review form, and review list to each product

function renderReviews(productId, container) {
  const reviews = JSON.parse(localStorage.getItem('pb_reviews_'+productId)||'[]');
  const avgRating = reviews.length ? (reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1) : '0.0';
  const stars = n => Array.from({length:5},(_,i)=>`<span style="color:${i<Math.round(n)?'#f59e0b':'#e2e8f0'};font-size:16px">★</span>`).join('');
  
  container.innerHTML = `
    <div style="border-top:1px solid #e2e8f0;padding:14px 0">
      <div style="font-size:14px;font-weight:800;margin-bottom:10px">⭐ Customer Reviews</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="font-size:36px;font-weight:900;color:#1e293b">${avgRating}</div>
        <div>
          <div>${stars(parseFloat(avgRating))}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">${reviews.length} review${reviews.length!==1?'s':''}</div>
        </div>
      </div>
      <div id="review-list-${productId}">
        ${reviews.slice(0,3).map(r=>`
          <div style="border-bottom:1px solid #f1f5f9;padding:10px 0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:13px">${r.name[0]}</div>
              <div><div style="font-size:13px;font-weight:700">${r.name}</div><div style="font-size:10px;color:#94a3b8">${r.date}</div></div>
              <div style="margin-left:auto">${stars(r.rating)}</div>
            </div>
            <div style="font-size:13px;color:#475569;line-height:1.5">${r.text}</div>
            ${r.petName?`<div style="font-size:11px;color:#1a4db3;margin-top:4px;font-weight:600">🐾 ${r.petName}</div>`:''}
          </div>`).join('')}
        ${!reviews.length?'<div style="font-size:13px;color:#94a3b8;text-align:center;padding:16px 0">No reviews yet. Be the first!</div>':''}
      </div>
      <button onclick="openReviewForm('${productId}')" style="width:100%;height:40px;border-radius:10px;border:1.5px solid #1a4db3;background:#eff6ff;color:#1a4db3;font-family:'Poppins',sans-serif;font-size:13px;font-weight:700;cursor:pointer;margin-top:10px">
        ✏️ Write a Review
      </button>
    </div>`;
}

function openReviewForm(productId) {
  const user = typeof Auth!=='undefined'?Auth.getUser():null;
  const pets = JSON.parse(localStorage.getItem('pb_my_pets')||'[]');
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px';
  let selectedRating = 5;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:400px;box-shadow:0 8px 40px rgba(0,0,0,0.2)">
      <div style="font-size:17px;font-weight:900;margin-bottom:16px">⭐ Write a Review</div>
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:6px">Your Rating</div>
        <div id="star-row" style="display:flex;gap:4px;font-size:32px;cursor:pointer">
          ${[1,2,3,4,5].map(n=>`<span data-n="${n}" onclick="setRating(${n})" style="color:#f59e0b">★</span>`).join('')}
        </div>
      </div>
      <input id="rev-name" placeholder="Your name" value="${user?.full_name||''}" style="width:100%;height:40px;border-radius:10px;border:1.5px solid #e2e8f0;padding:0 12px;font-family:'Poppins',sans-serif;font-size:13px;outline:none;margin-bottom:8px">
      <input id="rev-pet" placeholder="Your pet's name (optional)" style="width:100%;height:40px;border-radius:10px;border:1.5px solid #e2e8f0;padding:0 12px;font-family:'Poppins',sans-serif;font-size:13px;outline:none;margin-bottom:8px">
      <textarea id="rev-text" placeholder="Share your experience with this product..." style="width:100%;height:80px;border-radius:10px;border:1.5px solid #e2e8f0;padding:10px 12px;font-family:'Poppins',sans-serif;font-size:13px;outline:none;resize:none;margin-bottom:14px"></textarea>
      <div style="display:flex;gap:8px">
        <button onclick="this.closest('div[style*=fixed]').remove()" style="flex:1;height:40px;border-radius:10px;border:1.5px solid #e2e8f0;background:#f8fafc;font-family:'Poppins',sans-serif;font-size:13px;font-weight:700;cursor:pointer">Cancel</button>
        <button onclick="submitReview('${productId}',this)" style="flex:1;height:40px;border-radius:10px;border:none;background:#1a4db3;color:#fff;font-family:'Poppins',sans-serif;font-size:13px;font-weight:700;cursor:pointer">Submit Review</button>
      </div>
    </div>`;
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  document.body.appendChild(overlay);
  window._reviewRating = 5;
  window.setRating = function(n) {
    window._reviewRating = n;
    overlay.querySelectorAll('#star-row span').forEach((s,i)=>s.style.color=i<n?'#f59e0b':'#e2e8f0');
  };
}

function submitReview(productId, btn) {
  const name = document.getElementById('rev-name').value.trim();
  const text = document.getElementById('rev-text').value.trim();
  const petName = document.getElementById('rev-pet').value.trim();
  if(!name||!text){alert('Please fill in your name and review.');return;}
  btn.textContent='Submitting...';btn.disabled=true;
  setTimeout(()=>{
    const reviews = JSON.parse(localStorage.getItem('pb_reviews_'+productId)||'[]');
    reviews.unshift({name,text,petName,rating:window._reviewRating||5,date:new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})});
    localStorage.setItem('pb_reviews_'+productId,JSON.stringify(reviews));
    btn.closest('div[style*="fixed"]').remove();
    // Re-render if container exists
    const cont = document.getElementById('reviews-'+productId);
    if(cont) renderReviews(productId,cont);
    const t=document.createElement('div');t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#16a34a;color:#fff;padding:10px 20px;border-radius:24px;font-size:13px;font-weight:700;z-index:9999;font-family:Poppins,sans-serif';
    t.textContent='⭐ Review submitted! Thank you.';document.body.appendChild(t);setTimeout(()=>t.remove(),2500);
  },800);
}
