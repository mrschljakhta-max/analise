// Literal, Unicode-aware substring match for SQLite GLOB.
// SQLite LIKE/LOWER are ASCII-only unless built with an ICU extension; D1 isn't.
// Every user character is escaped, and each single-codepoint case pair is
// expressed as a GLOB class. This value is ALWAYS bound as a SQL parameter.
const casePair=ch=>{
 const low=ch.toLocaleLowerCase("uk-UA");
 const high=ch.toLocaleUpperCase("uk-UA");
 const simple=Array.from(low).length===1&&Array.from(high).length===1;
 return simple&&low!==high&&![...low,...high].some(c=>"[]*?-".includes(c))
  ? "["+low+high+"]"
  : ch;
};
export function literalUnicodeGlob(input){
 const parts=Array.from(String(input??"")).map(ch=>{
  if(ch==="*")return "[*]";
  if(ch==="?")return "[?]";
  if(ch==="[")return "[[]";
  if(ch==="]")return "[]]";
  return casePair(ch);
 });
 return "*"+parts.join("")+"*";
}
