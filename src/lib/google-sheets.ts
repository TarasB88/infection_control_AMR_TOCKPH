export type SheetRecord=Record<string,string>;
export type GoogleSheetTab='Facilities'|'Facility_IPC_Profile'|'IPC_Visits'|'IPC_Assessments'|'Recommendations'|'Legal_Acts'|'Training_Events'|'Training_Facility_Stats'|'AST_Data'|'WGS_Staging'|'Dictionaries'|'Users';
export type AppSessionUser={id:string;username:string;email:string;fullName:string;role:'admin'|'operator'|'analyst';allFacilities:boolean;facilityCodes:string[];mustChangePassword:boolean};
export const GOOGLE_SHEET_TABS:GoogleSheetTab[]=['Facilities','Facility_IPC_Profile','IPC_Visits','IPC_Assessments','Recommendations','Legal_Acts','Training_Events','Training_Facility_Stats','AST_Data','WGS_Staging','Dictionaries','Users'];
async function api<T>(path:string,init:RequestInit={}):Promise<T>{
 const response=await fetch(path,{...init,credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json',...(init.headers||{})}});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error((body as {error?:string}).error||'Помилка серверного запиту: HTTP '+response.status);
 return body as T;
}
export const loginWithPassword=async(username:string,password:string):Promise<AppSessionUser>=>{
 const result=await api<{user:AppSessionUser}>('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})});return result.user;
};
export const getCurrentUser=async():Promise<AppSessionUser|null>=>{
 try{return (await api<{user:AppSessionUser}>('/api/auth/me')).user;}catch(error){if(error instanceof Error&&error.message==='Потрібно увійти в систему.')return null;return null;}
};
export const clearGoogleSession=():void=>{void fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'}});};
export const readSheetTable=async(sheet:GoogleSheetTab):Promise<{headers:string[];rows:SheetRecord[]}>=>api('/api/sheets/'+encodeURIComponent(sheet));
export const appendSheetRows=async(sheet:GoogleSheetTab,headers:string[],rows:Array<Array<string|number|boolean>>):Promise<void>=>{
 if(!rows.length)return;await api('/api/sheets/'+encodeURIComponent(sheet),{method:'POST',body:JSON.stringify({headers,rows})});
};
export const changePassword=async(currentPassword:string,newPassword:string):Promise<AppSessionUser>=>{const result=await api<{user:AppSessionUser}>('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});return result.user;};
export const createUser=async(input:{username:string;password:string;email:string;displayName:string;role:'admin'|'operator'|'analyst';allFacilities:boolean;facilityCodes:string[];isActive:boolean}):Promise<void>=>{
 await api('/api/admin/users',{method:'POST',body:JSON.stringify(input)});
};
export const createMissingSheetTabs=async(_names:string[]):Promise<void>=>{};
export const getSpreadsheetTabs=async():Promise<string[]>=>[...GOOGLE_SHEET_TABS];
