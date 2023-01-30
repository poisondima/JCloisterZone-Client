function locale_cs_sk(choice, choicesLength) {
  if (choice === 0) {
    return 0;
  }
  if (choice === 1) {
    return 1;
  }
  if (choice > 1 && choice <= 4) {
    return 2;
  }
  return 3;
}
function locale_ru(choice, choicesLength) {
  if (choice === 0) {
    return 0;
  }

  const teen = choice > 10 && choice < 20;
  const endsWithOne = choice % 10 === 1;

  if (choicesLength < 4) {
    return (!teen && endsWithOne) ? 1 : 2;
  }
  if (!teen && endsWithOne) {
    return 1;
  }
  if (!teen && choice % 10 >= 2 && choice % 10 <= 4) {
    return 2;
  }

  return (choicesLength < 4) ? 2 : 3;
}
      
export default (context) => {
  return {
    fallbackLocale: "cs",
    pluralizationRules: {
      "cs": locale_cs_sk,
      "ru": locale_ru,
      "sk": locale_cs_sk
    }
  }
}