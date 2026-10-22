// Native JPEG transcodes are not byte-identical to submitted PNGs. Recovery
// compares every decoded RGB pixel against the bound local asset; never URL/title only.
export function compareDouyinCoverPixels(a,b,width,height,nativeWidth,nativeHeight) {
 const fail=reason=>({ok:false,reason});
 if(!a||!b||a.length!==b.length||a.length!==width*height*4||width<800||height<800)return fail('pixel_shape_invalid');
 if(Math.abs(width-nativeWidth)>3||Math.abs(height-nativeHeight)>3)return fail('native_dimensions_changed');
 let abs=0,sq=0,sx=0,sy=0,sxx=0,syy=0,sxy=0,n=0;
 for(let i=0;i<a.length;i+=4)for(let c=0;c<3;c++){const x=a[i+c],y=b[i+c];if(!Number.isFinite(x)||!Number.isFinite(y)||a[i+3]!==255||b[i+3]!==255)return fail('nonopaque_pixels');const d=x-y;abs+=Math.abs(d);sq+=d*d;sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;n++}
 const mae=abs/n,rmse=Math.sqrt(sq/n),den=Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy)),correlation=den>0?(n*sxy-sx*sy)/den:0;
 return {ok:mae<=3&&rmse<=7&&correlation>=.995,reason:'full_rgb_decoded_comparison',mae,rmse,correlation,width,height,nativeWidth,nativeHeight};
}
export async function probeDouyinCoverPixels(slot,sourceDataUrl,compareSource) {
 const fail=reason=>({ok:false,reason});
 const compact=v=>String(v||'').replace(/\s+/g,' ').trim();
 const re=slot==='portrait'?/竖封面\s*3\s*:\s*4/:slot==='landscape'?/横封面\s*4\s*:\s*3/:null;if(!re)return fail('slot_invalid');
 const cards=[...document.querySelectorAll('.coverControl-CjlzqC')].filter(x=>re.test(compact(x.innerText||x.textContent)));
 if(cards.length!==1)return fail('cover_card_not_unique');const images=[...cards[0].querySelectorAll('img')].filter(x=>x.complete&&x.naturalWidth>0);
 if(images.length!==1)return fail('cover_image_not_unique');const url=images[0].src;
 try {const u=new URL(url);if(u.protocol!=='https:'||!(/(^|\.)(douyinpic\.com|pstatp\.com|byteimg\.com|bytedance\.com|ibytedtos\.com)$/.test(u.hostname)||/^p\d+-creator-media(?:-private)?\.douyin\.com$/.test(u.hostname)))return fail('cover_url_untrusted');}catch{return fail('cover_url_invalid')}
 try {
 const resp=await fetch(url);if(!resp.ok)return fail('native_fetch_failed');
 const nativeBlob=await resp.blob(),localBlob=await(await fetch(sourceDataUrl)).blob();
 const local=await createImageBitmap(localBlob),native=await createImageBitmap(nativeBlob);
 const canvas=document.createElement('canvas');canvas.width=local.width;canvas.height=local.height;const context=canvas.getContext('2d',{willReadFrequently:true});
 context.drawImage(local,0,0);const a=context.getImageData(0,0,local.width,local.height).data;
 context.clearRect(0,0,local.width,local.height);context.drawImage(native,0,0,local.width,local.height);const b=context.getImageData(0,0,local.width,local.height).data;
 const compare=(0,eval)('('+compareSource+')');const result=compare(a,b,local.width,local.height,native.width,native.height);local.close();native.close();
 if(images[0].src!==url||!cards[0].isConnected)return fail('cover_changed_during_comparison');
 return {...result,afterUrl:url,nativeBlobSize:nativeBlob.size,mode:'full_native_rgb_match_bound_source'};
 }catch(error){return fail('native_pixels_unreadable:'+String(error?.message||error).slice(0,160))}
}
