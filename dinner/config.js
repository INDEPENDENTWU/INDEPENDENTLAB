window.DINNER_STEPS=[
{id:'people',title:'跟谁？',type:'choice',options:[['想见的人','want',3],['熟人','familiar',1],['不太熟','not-close',-1],['其实不想见','avoid',-3]]},
{id:'travel',title:'来回要多久？',type:'choice',options:[['半小时内','short',1.5],['差不多一小时','medium',0],['两小时左右','long',-2],['光想想就累','pain',-3]]},
{id:'spend',title:'大概要花多少？',type:'money'},
{id:'tomorrow',title:'明天有事吗？',type:'choice',options:[['没什么事','free',2],['正常上班','work',0],['得早起','early',-2],['明天已经够烦了','rough',-3]]},
{id:'after',title:'吃完还有下一摊吗？',type:'choice',options:[['没有','no',1],['不好说','maybe',-.5],['肯定有','yes',-2]]},
{id:'desire',title:'其实你想去吗？',type:'range'}].map(s=>({...s,options:s.options?.map(([label,value,score])=>({label,value,score}))}));