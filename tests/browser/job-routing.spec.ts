import {test,expect} from '@playwright/test';
for(const destination of ['generate','chat'])for(const source of ['generate','chat'])for(const action of ['same','new','retry'])test(`${source} to ${destination} ${action} routes to review without submitting`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{Object.defineProperty(crypto,'randomUUID',{value:undefined});Object.defineProperty(navigator,'clipboard',{value:undefined});});
 const request={workflow:'text-to-image',prompt:'A mountain in soft morning light',mode:'sfw',capabilities_revision:'v1',seed:'random',count:2,note:'Mountain study',output:{aspect:'9:16',size:'1mp'}};
 const job={id:'original',submission_id:'batch',submission_index:1,state:action==='retry'?'failed':'completed',request,seed:'4102',outputs:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString(),source:source==='chat'?{chat_id:'chat1',card_id:'card1',revision:1}:undefined};
 const chat={id:'chat1',title:'Mountains',mode:'sfw',workflow:null,version:0,epoch:0,activity:'idle',reasoning:true,messages:[],assets:[],jobs:[],accounting:[],groups:[]};
 let repeat:any;const posts:string[]=[];
 await page.route('**/api/v1/jobs**',r=>{if(r.request().url().endsWith('/branch-chat')){repeat=r.request().postDataJSON();return r.fulfill({json:chat});}if(r.request().method()==='POST')posts.push(r.request().url());return r.fulfill({json:r.request().url().endsWith('/original')?job:{items:[job]}});});
 await page.route('**/api/v1/chats**',r=>{if(r.request().url().endsWith('/repeat'))repeat=r.request().postDataJSON();return r.fulfill({json:new URL(r.request().url()).pathname==='/api/v1/chats'?{items:[chat]}:chat});});
 await page.goto('/');
 if(await page.getByRole('button',{name:'Toggle sidebar',exact:true}).isVisible())await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
 await page.locator('.jobs-button').click();await page.getByRole('button',{name:'View job details',exact:true}).click();
 await expect(page.getByRole('button',{name:'Create another request',exact:true})).toHaveCount(action==='retry'?0:1);
 if(action==='retry')await page.getByRole('button',{name:'Retry',exact:true}).click();else{await page.getByRole('button',{name:'Create another request',exact:true}).click();await page.getByRole('button',{name:destination==='chat'?'Branch in Chat':'Branch in Generate',exact:true}).click();await page.getByRole('button',{name:action==='same'?'Same seed':'New seed',exact:true}).click();}
 if((action==='retry'?source:destination)==='chat'){await expect(page).toHaveURL(/chat\?fromJob=original/);await expect(page.locator('.branch-draft-preview')).toContainText('Text to image');expect(repeat).toBeUndefined();}
 else{await expect(page.locator('textarea').first()).toHaveValue(request.prompt);const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem('seed.drafts.v2')!)['text-to-image']);expect(draft).toMatchObject({count:1,seed:'4102',randomSeed:action==='new',note:request.note,aspect:'9:16',sourceJob:'original'});}
 expect(posts).toEqual([]);expect(errors).toEqual([]);
});

test('Generate restores video inputs and submits only after explicit approval',async({page})=>{
 const ref={id:'ref1',asset_id:'input',kind:'video',role:'reference',range:{start_seconds:2,duration_seconds:5},include_audio:true};
 const request={workflow:'reference-to-video',prompt:'Use <Video 1> as reference',mode:'sfw',capabilities_revision:'old',seed:'random',count:2,note:'Study',quality:'high',audio:{output:'silent'},references:[ref],output:{aspect:'9:16',size:'native',duration_seconds:10,format:'video'}};
 const job={id:'original',request,seed:'9876'};
 let submitted:any;
 await page.route('**/api/v1/jobs/original',r=>r.fulfill({json:job}));
 await page.route('**/api/v1/jobs/original/repeat',r=>{submitted=r.request().postDataJSON();return r.fulfill({json:{jobs:[]}});});
 await page.route('**/api/v1/assets/input',r=>r.fulfill({json:{name:'Input clip',kind:'video',mime_type:'video/mp4',metadata:{duration_seconds:12}}}));
 await page.route('**/api/v1/studio',r=>r.fulfill({json:{worker:{connected:true,stale:false,state:'ready'},queue:{paused:false,active:0,waiting:0}}}));
 await page.route('**/api/v1/capabilities',r=>r.fulfill({json:{revision:'new',workflows:{'reference-to-video':{enabled:true,modes:['sfw'],native_export:true,qualities:['high','fast']}}}}));
 await page.goto('/?fromJob=original&seed=same');
 await expect(page.getByRole('combobox',{name:'Prompt',exact:true})).toHaveText('Use Video 1 as reference');
 expect(submitted).toBeUndefined();
 await page.getByRole('button',{name:/^Create video/}).click();
 await expect.poll(()=>submitted).toBeDefined();
 expect(submitted.request).toEqual({...request,count:1,seed:'9876',resolved_seeds:['9876'],capabilities_revision:'new',output:{aspect:'9:16',size:'native',duration_seconds:10}});
});

