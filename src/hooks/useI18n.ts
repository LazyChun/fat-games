import { useEffect, useMemo } from "react";
import { useIntl } from "react-intl";

const useI18n = () => {
  try {
    const intl = useIntl();
    const text = useMemo(() => {
      return (id?: string, values?: Record<string, string | number>) => {
        if (!id) id = "common.i18n.empty";
        return intl.formatMessage({ id }, values);
      };
    }, [intl]);

    const i18nObj = useMemo(
      () => ({
        text,
        field: () => "",
        locale: intl.locale.replace("-", "_"),
        value: intl.locale.toLowerCase().indexOf("en") >= 0 ? "en" : "cn",
      }),
      [text, intl.locale],
    );

    useEffect(() => {
      window.i18n = i18nObj;
    }, [i18nObj]);

    return i18nObj;
  } catch (e) {
    console.log("i18n error");
    if (window.i18n) return window.i18n;
    return {
      text: () => "i18n error",
      field: () => "i18n error",
      locale: "",
      value: "",
    };
  }
};

export default useI18n;
