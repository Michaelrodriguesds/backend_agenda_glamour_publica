// Testes da lógica pura da aba "Clientes & Marketing".
// Datas fixas: "hoje" = 2026-10-30 (sexta-feira).
const cfg = require("../src/config/marketing");
const svc = require("../src/services/marketing");

const TODAY = "2026-10-30";
const d = (str) => new Date(str + "T00:00:00.000Z");
const apt = (over) => ({
  _id: over._id || Math.random().toString(16).slice(2),
  clientName: "Maria",
  procedures: ["Cílios Tufinho"],
  date: d(TODAY),
  time: "10:00",
  location: "Studio Manilha",
  price: 100,
  ...over,
});
const NO_PREFS = new Map();
const NO_SENT = new Set();

// Serviços de um negócio de exemplo, como a dona cadastra em "Meu negócio".
const SERVICES = [
  { name: "Cílios Tufinho",        returnDays: 15 },
  { name: "Sobrancelha com Henna", returnDays: 20 },
  { name: "Depilação",             returnDays: 30 },
  { name: "Corte",                 returnDays: 0 },  // 0 = não lembra
  { name: "Manicure" },                              // sem prazo = não lembra
];
const DAYS = svc.returnDaysFromServices(SERVICES);

describe("datas", () => {
  it("calcula 'hoje' no fuso de Brasília (madrugada UTC ainda é ontem)", () => {
    // 02:30 UTC de 31/10 = 23:30 de 30/10 em Brasília.
    expect(svc.todayLocal(new Date("2026-10-31T02:30:00Z"), cfg.TIMEZONE)).toBe("2026-10-30");
    expect(svc.todayLocal(new Date("2026-10-31T03:30:00Z"), cfg.TIMEZONE)).toBe("2026-10-31");
  });

  it("soma dias atravessando o mês e calcula diferença", () => {
    expect(svc.addDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(svc.addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(svc.diffDays("2026-10-15", "2026-10-30")).toBe(15);
  });

  it("lê procedimentos no formato novo e no antigo", () => {
    expect(svc.proceduresOf({ procedures: ["A", "B"] })).toEqual(["A", "B"]);
    expect(svc.proceduresOf({ procedures: [], procedure: "A + B" })).toEqual(["A", "B"]);
    expect(svc.proceduresOf({})).toEqual([]);
  });
});

describe("returnDaysFromServices", () => {
  it("só entra serviço com prazo inteiro maior que zero", () => {
    expect([...DAYS.entries()]).toEqual([
      ["cílios tufinho", 15], ["sobrancelha com henna", 20], ["depilação", 30],
    ]);
    expect(svc.returnDaysFromServices(undefined).size).toBe(0);
    expect(svc.returnDaysFromServices([{ name: "X", returnDays: "abc" }, null]).size).toBe(0);
  });
});

describe("buildTomorrowList", () => {
  it("ordena por horário, marca enviados e respeita 'não lembrar'", () => {
    const list = [
      apt({ _id: "2", clientName: "Ana", time: "14:00" }),
      apt({ _id: "1", clientName: "Bia", time: "09:00" }),
      apt({ _id: "3", clientName: "Carla", time: "11:00" }),
    ];
    const prefs = svc.prefsToMap([{ clientName: "Carla", remindAppointment: false }]);
    const sent = new Set([svc.appointmentKey("1")]);

    const out = svc.buildTomorrowList(list, prefs, sent);
    expect(out.map((i) => i.clientName)).toEqual(["Bia", "Ana"]);
    expect(out[0]).toMatchObject({ sent: true, key: "appt|1", procedure: "Cílios Tufinho", time: "09:00" });
    expect(out[1].sent).toBe(false);
  });

  it("ignora agendamento sem nome", () => {
    expect(svc.buildTomorrowList([apt({ clientName: "  " })], NO_PREFS, NO_SENT)).toEqual([]);
  });
});

describe("buildReturnList", () => {
  it("aparece no dia do prazo e até prazo + janela", () => {
    const list = [
      apt({ clientName: "Ana", date: d("2026-10-15") }),                                  // 15 dias, prazo 15 → entra
      apt({ clientName: "Bia", date: d("2026-10-16") }),                                  // 14 dias → ainda não
      apt({ clientName: "Carla", date: d("2026-10-01") }),                                // 29 dias = 15 + 14 → entra
      apt({ clientName: "Dani", date: d("2026-09-30") }),                                 // 30 dias → passou da janela
    ];
    const out = svc.buildReturnList(list, TODAY, NO_PREFS, NO_SENT, DAYS, cfg);
    expect(out.map((i) => i.clientName).sort()).toEqual(["Ana", "Carla"]);
    expect(out[0].clientName).toBe("Carla"); // mais atrasada primeiro
  });

  it("não aparece se a cliente já tem horário de hoje em diante", () => {
    const list = [
      apt({ clientName: "Ana", date: d("2026-10-15") }),
      apt({ clientName: "Ana", date: d("2026-11-05") }),
    ];
    expect(svc.buildReturnList(list, TODAY, NO_PREFS, NO_SENT, DAYS, cfg)).toEqual([]);

    const today = [apt({ clientName: "Bia", date: d("2026-10-15") }), apt({ clientName: "Bia", date: d(TODAY) })];
    expect(svc.buildReturnList(today, TODAY, NO_PREFS, NO_SENT, DAYS, cfg)).toEqual([]);
  });

  it("usa o prazo de cada procedimento e conta do ÚLTIMO atendimento dele", () => {
    const list = [
      apt({ clientName: "Ana", procedures: ["Sobrancelha com Henna"], date: d("2026-10-01") }),
      apt({ clientName: "Ana", procedures: ["Sobrancelha com Henna"], date: d("2026-10-10") }), // último: 20 dias
      apt({ clientName: "Ana", procedures: ["Depilação"], date: d("2026-10-10") }),            // 20 dias, prazo 30 → não
    ];
    const out = svc.buildReturnList(list, TODAY, NO_PREFS, NO_SENT, DAYS, cfg);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ procedure: "Sobrancelha com Henna", lastDate: "2026-10-10", daysSince: 20, returnDays: 20 });
  });

  it("serviço sem prazo (0, vazio ou que saiu da lista) não gera lembrete", () => {
    const list = [
      apt({ clientName: "Ana", procedures: ["Corte"], date: d("2026-09-30") }),
      apt({ clientName: "Bia", procedures: ["Manicure"], date: d("2026-09-30") }),
      apt({ clientName: "Carla", procedures: ["Serviço Antigo"], date: d("2026-09-30") }),
    ];
    expect(svc.buildReturnList(list, TODAY, NO_PREFS, NO_SENT, DAYS, cfg)).toEqual([]);
  });

  it("negócio sem nenhum prazo configurado: lista vazia", () => {
    const list = [apt({ clientName: "Ana", date: d("2026-10-15") })];
    expect(svc.buildReturnList(list, TODAY, NO_PREFS, NO_SENT, new Map(), cfg)).toEqual([]);
  });

  it("compara o nome do serviço sem ligar para maiúsculas e espaços", () => {
    const list = [apt({ clientName: "Ana", procedures: [" cílios tufinho "], date: d("2026-10-15") })];
    const out = svc.buildReturnList(list, TODAY, NO_PREFS, NO_SENT, DAYS, cfg);
    expect(out).toHaveLength(1);
    expect(out[0].returnDays).toBe(15);
  });

  it("respeita 'não lembrar' e marca enviados pela chave do ciclo", () => {
    const list = [apt({ clientName: "Ana", date: d("2026-10-15") }), apt({ clientName: "Bia", date: d("2026-10-15") })];
    const prefs = svc.prefsToMap([{ clientName: "Bia", remindReturn: false }]);
    const sent = new Set([svc.returnKey("Ana", "Cílios Tufinho", "2026-10-15")]);
    const out = svc.buildReturnList(list, TODAY, prefs, sent, DAYS, cfg);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ clientName: "Ana", sent: true });
  });

  it("lê agendamentos antigos que só têm 'procedure' em texto", () => {
    const list = [apt({ clientName: "Ana", procedures: undefined, procedure: "Cílios Tufinho + Depilação", date: d("2026-10-15") })];
    const out = svc.buildReturnList(list, TODAY, NO_PREFS, NO_SENT, DAYS, cfg);
    expect(out.map((i) => i.procedure)).toEqual(["Cílios Tufinho"]);
  });
});

describe("buildMovement", () => {
  it("calcula médias por dia da semana, dia mais fraco e períodos", () => {
    const days = 14; // 2026-10-16 (sex) até 2026-10-29 (qui): 2 de cada dia
    const list = [
      // Sexta (16 e 23): 3 + 3 = 6 → média 3
      ...[1, 2, 3].map(() => apt({ date: d("2026-10-16"), time: "09:00" })),
      ...[1, 2, 3].map(() => apt({ date: d("2026-10-23"), time: "14:00" })),
      // Terça (20 e 27): 1 + 0 = 1 → média 0,5
      apt({ date: d("2026-10-20"), time: "18:00" }),
      // Fora do período: hoje e muito antigo
      apt({ date: d(TODAY) }),
      apt({ date: d("2026-01-01") }),
    ];
    const m = svc.buildMovement(list, TODAY, days);
    expect(m.total).toBe(7);
    const fri = m.weekdays.find((w) => w.label === "Sex");
    const tue = m.weekdays.find((w) => w.label === "Ter");
    expect(fri.average).toBe(3);
    expect(tue.average).toBe(0.5);
    expect(m.weakest.label).toBe("Ter");
    expect(m.strongest.label).toBe("Sex");
    expect(m.differencePercent).toBe(83);
    expect(m.periods.map((p) => p.count)).toEqual([3, 3, 1]);
    expect(m.periods.reduce((s, p) => s + p.percent, 0)).toBeGreaterThanOrEqual(99);
  });

  it("dia sem nenhum atendimento (ex.: domingo fechado) não vira 'dia mais fraco'", () => {
    const list = [apt({ date: d("2026-10-26"), time: "10:00" }), apt({ date: d("2026-10-27"), time: "10:00" }), apt({ date: d("2026-10-27") })];
    const m = svc.buildMovement(list, TODAY, 14);
    expect(m.weakest.label).toBe("Seg");
  });

  it("sem dados: nada quebra", () => {
    const m = svc.buildMovement([], TODAY, 90);
    expect(m.total).toBe(0);
    expect(m.weakest).toBeNull();
    expect(m.differencePercent).toBeNull();
    expect(m.periods.every((p) => p.percent === 0)).toBe(true);
  });
});

describe("buildSegments", () => {
  it("separa fiéis, sumidas e novas", () => {
    const list = [
      // Fiel: 3 visitas recentes
      apt({ clientName: "Fiel", date: d("2026-08-01"), price: 100 }),
      apt({ clientName: "Fiel", date: d("2026-09-01"), price: 100 }),
      apt({ clientName: "Fiel", date: d("2026-10-01"), price: 100 }),
      // Sumida: última há 80 dias, nada marcado
      apt({ clientName: "Sumida", date: d("2026-08-11") }),
      // Sumida mas com horário marcado → não conta
      apt({ clientName: "Volta", date: d("2026-07-01") }),
      apt({ clientName: "Volta", date: d("2026-11-03") }),
      // Nova: primeira visita há 10 dias
      apt({ clientName: "Nova", date: d("2026-10-20") }),
      // Só tem horário futuro: ainda não é cliente "nova"
      apt({ clientName: "Futura", date: d("2026-11-10") }),
    ];
    const s = svc.buildSegments(list, TODAY, cfg);
    expect(s.loyal.map((c) => c.clientName)).toEqual(["Fiel"]);
    expect(s.loyal[0]).toMatchObject({ visits: 3, revenue: 300 });
    expect(s.inactive.map((c) => c.clientName)).toEqual(["Sumida"]);
    expect(s.inactive[0].daysSince).toBe(80);
    expect(s.newClients.map((c) => c.clientName)).toEqual(["Nova"]);
  });

  it("fiéis: no máximo 10, por visitas e depois por valor", () => {
    const list = [];
    for (let i = 0; i < 12; i++) {
      list.push(apt({ clientName: `C${String(i).padStart(2, "0")}`, date: d("2026-10-01"), price: i }));
      list.push(apt({ clientName: `C${String(i).padStart(2, "0")}`, date: d("2026-10-02"), price: i }));
    }
    const s = svc.buildSegments(list, TODAY, cfg);
    expect(s.loyal).toHaveLength(10);
    expect(s.loyal[0].clientName).toBe("C11");
  });

  it("uma visita só não é fiel; exatamente 60 dias ainda não é sumida", () => {
    const list = [apt({ clientName: "Uma", date: d("2026-08-31") })]; // 60 dias
    const s = svc.buildSegments(list, TODAY, cfg);
    expect(s.loyal).toEqual([]);
    expect(s.inactive).toEqual([]);
  });
});
