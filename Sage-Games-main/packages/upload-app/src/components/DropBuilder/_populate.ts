export const populateWithTestData = () => {
  const getDate = (addedHours: number): Date => {
    var today = new Date();
    today.setHours(today.getHours() + addedHours);
    return today;
  };
  const setInputVal = (id: string, val: any) => {
    var element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
    if (element instanceof HTMLInputElement) {
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeInputValueSetter.call(element, val);
    } else if (element instanceof HTMLTextAreaElement) {
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      nativeInputValueSetter.call(element, val);
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const setSelectedIndex = (id: string, idx: number) => {
    var element = document.getElementById(id) as HTMLSelectElement;
    var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "selectedIndex"
    ).set;
    nativeInputValueSetter.call(element, idx);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  setInputVal("name", "Test Drop");
  setInputVal("artistWallet", "0x19596e1D6cd97916514B5DBaA4730781eFE49975");
  setInputVal(
    "description",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. In pretium leo vitae elementum aliquet."
  );
  setSelectedIndex("target", 2);
  //setInputVal("pmySalesSplit1", "100");
  //setInputVal("pmySalesSplitAddr1", "0x19596e1D6cd97916514B5DBaA4730781eFE49975");
  //setInputVal("rltyPercent", "10");
  //setInputVal("rltySplit1", "100");
  //setInputVal("rltySplitAddr1", "0x19596e1D6cd97916514B5DBaA4730781eFE49975");
  // document.getElementById("addDrawingGameTab").click();
  // setTimeout(() => {
  //   setInputVal("drawingStartDate", getDate(1));
  //   setInputVal("drawingEndDate", getDate(2));
  //   setInputVal("ticketCostPoints", "1");
  //   setInputVal("ticketCostTokens", "0.01");
  //   setInputVal("maxTickets", "500");
  //   setInputVal("maxTicketsPerUser", "5");
  // }, 500); // give a moment for the elements to be added to the DOM after the click()
};
