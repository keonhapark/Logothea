interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 화면 읽기용 이름. 보이는 글이 따로 있으면 aria-labelledby 를 쓴다. */
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  disabled?: boolean
}

/**
 * 켜고 끄는 스위치. 바탕은 눌린 자리(.dent), 손잡이는 작은 구름(.cloud-s)이다(docs/design/design-system.md 재질).
 * 켜지면 바탕이 올리브로 물들고 손잡이가 오른쪽으로 간다. 색만으로 상태를 알리지 않도록 위치가 함께 바뀐다.
 */
export default function Switch({ checked, onChange, ariaLabel, ariaLabelledBy, ariaDescribedBy, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="dent relative shrink-0 w-[46px] h-[26px] rounded-full transition-colors duration-200 disabled:opacity-50"
      style={checked ? { background: 'rgb(var(--olive-rgb) / 0.35)' } : undefined}
    >
      <span
        aria-hidden
        className={`cloud-s absolute top-[3px] left-[3px] w-5 h-5 rounded-full transition-transform duration-200 motion-reduce:transition-none ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
