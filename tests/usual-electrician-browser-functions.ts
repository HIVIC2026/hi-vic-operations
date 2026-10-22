export const saveTradeUsualElectrician = async ({ data }: { data: unknown }) => {
  localStorage.setItem("test-usual-electrician", JSON.stringify(data));
  return { electrician: data };
};